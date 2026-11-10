//! Cache de imagens (capas) em disco, com limite de tamanho. A interface pede `image_fetch(url)` e recebe o caminho
//! do arquivo, que serve pelo protocolo `asset`; na vez seguinte a capa vem do disco, sem rede.

use crate::model::Res;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

pub fn dir(app: &tauri::AppHandle) -> Res<PathBuf> { app.path().app_data_dir().map(|d| d.join("images")).map_err(|e| e.to_string()) }

fn name_for(url: &str) -> String { Sha256::digest(url.as_bytes()).iter().take(12).map(|b| format!("{b:02x}")).collect() }

fn ext_for(mime: &str) -> &'static str {
    let m = mime.to_ascii_lowercase();
    if m.contains("png") { "png" } else if m.contains("webp") { "webp" } else if m.contains("gif") { "gif" } else if m.contains("svg") { "svg" } else if m.contains("avif") { "avif" } else { "jpg" }
}

/// Procura o arquivo já baixado dessa URL (qualquer extensão).
pub fn cached_path(dir: &Path, url: &str) -> Option<PathBuf> {
    let stem = name_for(url);
    std::fs::read_dir(dir).ok()?.flatten().map(|f| f.path()).find(|p| p.file_stem().and_then(|s| s.to_str()) == Some(stem.as_str()) && p.extension().map_or(false, |e| e != "part"))
}

pub fn used_bytes(dir: &Path) -> (u64, usize) {
    std::fs::read_dir(dir).map(|rd| rd.flatten().filter_map(|f| f.metadata().ok()).filter(|m| m.is_file()).fold((0, 0), |(b, n), m| (b + m.len(), n + 1))).unwrap_or((0, 0))
}

/// Apaga os arquivos mais antigos até caber em `limit_bytes`. Devolve quantos saíram.
pub fn trim(dir: &Path, limit_bytes: u64) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = rd.flatten().filter_map(|f| { let m = f.metadata().ok()?; m.is_file().then(|| (m.modified().unwrap_or(std::time::UNIX_EPOCH), m.len(), f.path())) }).collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    files.sort_by_key(|f| f.0);
    let mut removed = 0;
    for (_, len, p) in files {
        if total <= limit_bytes { break; }
        if std::fs::remove_file(&p).is_ok() { total = total.saturating_sub(len); removed += 1; }
    }
    removed
}

pub async fn fetch_into(dir: &Path, url: &str, limit_mb: i64) -> Res<PathBuf> {
    if !(url.starts_with("https://") || url.starts_with("http://")) { return Err("só endereços http(s)".into()); }
    if let Some(p) = cached_path(dir, url) {
        // marca como usada agora, para o limite descartar as mais antigas e não as mais vistas
        let _ = std::fs::OpenOptions::new().write(true).open(&p).and_then(|f| f.set_modified(std::time::SystemTime::now()));
        return Ok(p);
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let r = crate::http::CLIENT.get(url).header("User-Agent", crate::http::BROWSER_UA).timeout(Duration::from_secs(15)).send().await.map_err(crate::http::err)?;
    if !r.status().is_success() { return Err(format!("HTTP {}", r.status())); }
    let mime = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if !mime.is_empty() && !mime.to_ascii_lowercase().starts_with("image/") { return Err("a resposta não é uma imagem".into()); }
    let bytes = r.bytes().await.map_err(crate::http::err)?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES { return Err("imagem vazia ou grande demais".into()); }
    let out = dir.join(format!("{}.{}", name_for(url), ext_for(&mime)));
    let part = out.with_extension("part");
    std::fs::write(&part, &bytes).and_then(|_| std::fs::rename(&part, &out)).map_err(|e| e.to_string())?;
    if limit_mb >= 0 { trim(dir, (limit_mb as u64) * 1024 * 1024); }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats { pub bytes: u64, pub files: usize }

#[tauri::command]
pub async fn image_fetch(app: tauri::AppHandle, url: String, limit_mb: i64) -> Res<String> {
    Ok(fetch_into(&dir(&app)?, &url, limit_mb).await?.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn image_cache_stats(app: tauri::AppHandle) -> Res<Stats> { let (bytes, files) = used_bytes(&dir(&app)?); Ok(Stats { bytes, files }) }
#[tauri::command]
pub fn image_cache_clear(app: tauri::AppHandle) -> Res<usize> { Ok(trim(&dir(&app)?, 0)) }

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mm-img-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    async fn server() -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = l.accept().await else { return };
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 2048];
                    let n = s.read(&mut buf).await.unwrap_or(0);
                    let path = String::from_utf8_lossy(&buf[..n]).split_whitespace().nth(1).unwrap_or("/").to_string();
                    let (st, mime, body): (&str, &str, Vec<u8>) = match path.as_str() {
                        p if p.starts_with("/a") => ("200 OK", "image/png", vec![1u8; 3000]),
                        "/texto" => ("200 OK", "text/html", b"<html>".to_vec()),
                        "/vazia" => ("200 OK", "image/jpeg", vec![]),
                        _ => ("404 Not Found", "text/plain", vec![]),
                    };
                    let _ = s.write_all(format!("HTTP/1.1 {st}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await;
                    let _ = s.write_all(&body).await;
                });
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn baixa_uma_vez_e_reaproveita() {
        let (d, base) = (tmp("uma"), server().await);
        let p = fetch_into(&d, &format!("{base}/a1"), -1).await.unwrap();
        assert!(p.extension().unwrap() == "png" && std::fs::metadata(&p).unwrap().len() == 3000);
        assert_eq!(cached_path(&d, &format!("{base}/a1")), Some(p.clone()));
        // a segunda vez não precisa de rede: com o servidor fora do ar a URL do cache continua valendo
        assert_eq!(fetch_into(&d, &format!("{base}/a1"), -1).await.unwrap(), p);
        assert_eq!(used_bytes(&d), (3000, 1));
    }

    #[tokio::test]
    async fn recusa_o_que_nao_e_imagem() {
        let (d, base) = (tmp("recusa"), server().await);
        for (path, quer) in [("/texto", "não é uma imagem"), ("/vazia", "vazia"), ("/nada", "HTTP 404")] {
            let e = fetch_into(&d, &format!("{base}{path}"), -1).await.unwrap_err();
            assert!(e.contains(quer), "{path}: {e}");
        }
        assert!(fetch_into(&d, "file:///etc/passwd", -1).await.is_err());
        assert_eq!(used_bytes(&d).1, 0);
    }

    #[tokio::test]
    async fn o_limite_descarta_as_mais_antigas() {
        let (d, base) = (tmp("limite"), server().await);
        // limite de 0 MB com arquivos de 3000 bytes: cada nova imagem expulsa as outras, mas o limite é em MB
        for i in 0..4 { fetch_into(&d, &format!("{base}/a{i}"), -1).await.unwrap(); std::thread::sleep(Duration::from_millis(15)); }
        assert_eq!(used_bytes(&d), (12000, 4));
        assert_eq!(trim(&d, 7000), 2, "sobram as duas mais novas");
        assert_eq!(used_bytes(&d), (6000, 2));
        assert!(cached_path(&d, &format!("{base}/a3")).is_some() && cached_path(&d, &format!("{base}/a0")).is_none());
        assert_eq!(trim(&d, 0), 2);
        assert_eq!(used_bytes(&d).1, 0);
    }
}
