//! Downloads: baixa a faixa inteira (pelo mesmo cache de áudio), copia para a pasta escolhida com um nome legível
//! e grava metadados, capa e letra. O arquivo baixado passa a tocar como fonte `local`, sem internet.

use crate::cache::{Cache, Refresh, FULL};
use crate::model::{Res, StreamInfo, TrackInfo};
use crate::tagging::{write as write_tags, TagData};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Done {
    pub path: String,
    pub bytes: u64,
    /// Aviso quando o arquivo foi salvo mas as tags não puderam ser gravadas.
    pub tag_warning: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct Options { pub write_tags: bool, pub embed_lyrics: bool }

/// Tira o que os sistemas de arquivos não aceitam e limita o tamanho.
pub fn sanitize(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let s = s.trim().trim_matches('.').trim().to_string();
    let s: String = s.chars().take(120).collect();
    if s.is_empty() { "faixa".into() } else { s }
}

/// `Artista - Título`.
pub fn file_stem(t: &TrackInfo) -> String {
    let artist = t.artists.first().map(String::as_str).unwrap_or("").trim();
    sanitize(&if artist.is_empty() { t.title.clone() } else { format!("{artist} - {}", t.title) })
}

/// `dir/stem.ext`, ou `dir/stem (2).ext` se já existir.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() { return first; }
    (2..).map(|n| dir.join(format!("{stem} ({n}).{ext}"))).find(|p| !p.exists()).unwrap()
}

/// Letra para gravar no arquivo: LRC (com tempos) quando sincronizada; texto simples senão.
pub fn lyrics_text(l: &crate::lyrics::Lyrics) -> String {
    if l.synced {
        l.lines.iter().map(|x| format!("[{:02}:{:05.2}]{}", (x.t / 60.0) as u32, x.t % 60.0, x.text)).collect::<Vec<_>>().join("\n")
    } else {
        l.lines.iter().map(|x| x.text.as_str()).collect::<Vec<_>>().join("\n")
    }
}

async fn fetch_cover(url: &str) -> Option<Vec<u8>> {
    let r = crate::http::CLIENT.get(url).header("User-Agent", crate::http::BROWSER_UA).timeout(Duration::from_secs(15)).send().await.ok()?;
    if !r.status().is_success() { return None; }
    let b = r.bytes().await.ok()?;
    (b.len() > 200 && b.len() < 12 * 1024 * 1024).then(|| b.to_vec())
}

/// Baixa `stream` pelo cache e grava em `folder`. `progress` recebe 0.0 a 1.0.
pub async fn download_stream(cache: &Arc<Cache>, track: &TrackInfo, stream: StreamInfo, refresh: Option<Refresh>, folder: &Path, opts: &Options, progress: impl Fn(f64)) -> Res<Done> {
    std::fs::create_dir_all(folder).map_err(|e| format!("não consegui criar a pasta de downloads: {e}"))?;
    let ext = stream.ext.clone();
    let entry = cache.entry_for(&stream);
    entry.touch();
    cache.fetch(&entry, stream, FULL, refresh);
    loop {
        let (have, total, complete, err) = { let s = entry.st.lock(); (s.have, s.total, s.complete, s.error.clone()) };
        if let Some(e) = err { return Err(e); }
        if complete { progress(1.0); break; }
        if let Some(t) = total.filter(|t| *t > 0) { progress((have as f64 / t as f64).min(0.99)); }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    let dest = unique_path(folder, &file_stem(track), &ext);
    let part = dest.with_extension(format!("{ext}.part"));
    std::fs::copy(&entry.path, &part).map_err(|e| format!("não consegui salvar o arquivo: {e}"))?;
    std::fs::rename(&part, &dest).map_err(|e| { let _ = std::fs::remove_file(&part); format!("não consegui concluir o arquivo: {e}") })?;
    let bytes = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    let mut tag_warning = None;
    if opts.write_tags || opts.embed_lyrics {
        let mut data = TagData { title: track.title.clone(), artists: track.artists.clone(), album: track.album.clone(), ..Default::default() };
        if opts.write_tags {
            if let Some(u) = track.artwork_url.as_deref().filter(|u| u.starts_with("http")) { data.cover = fetch_cover(u).await; }
        }
        if opts.embed_lyrics {
            let order = vec!["better".to_string(), "lrclib".to_string()];
            if let Ok(Some(l)) = crate::lyrics::get(track, &order).await { data.lyrics = Some(lyrics_text(&l)); }
        }
        if !opts.write_tags { data.title.clear(); data.artists.clear(); data.album = None; data.cover = None; }
        let dest2 = dest.clone();
        match tauri::async_runtime::spawn_blocking(move || write_tags(&dest2, &data)).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tag_warning = Some(e),
            Err(e) => tag_warning = Some(e.to_string()),
        }
    }
    Ok(Done { path: dest.to_string_lossy().into_owned(), bytes, tag_warning })
}

/// Pasta de downloads: a escolhida, ou `Música/MetroMusic`.
pub fn resolve_folder(app: &tauri::AppHandle, chosen: &str) -> Res<PathBuf> {
    let c = chosen.trim();
    if !c.is_empty() {
        if let Some(rest) = c.strip_prefix("~/") { return app.path().home_dir().map(|h| h.join(rest)).map_err(|e| e.to_string()); }
        return Ok(PathBuf::from(c));
    }
    app.path().audio_dir().or_else(|_| app.path().home_dir().map(|h| h.join("Music"))).map(|d| d.join("MetroMusic")).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_track(app: tauri::AppHandle, player: tauri::State<'_, crate::playback::Player>, track: TrackInfo, folder: String, write_tags: bool, embed_lyrics: bool, order: Vec<String>) -> Res<Done> {
    let dir = resolve_folder(&app, &folder)?;
    let stream = crate::providers::resolve(&track, &order).await?;
    let (t, o) = (track.clone(), order.clone());
    let refresh: Refresh = Arc::new(move || { let (t, o) = (t.clone(), o.clone()); Box::pin(async move { crate::providers::invalidate(&t.provider, &t.id); crate::providers::resolve(&t, &o).await }) });
    let key = track.key();
    let a2 = app.clone();
    let cache = player.cache.clone();
    download_stream(&cache, &track, stream, Some(refresh), &dir, &Options { write_tags, embed_lyrics }, move |p| { let _ = a2.emit("download:progress", serde_json::json!({ "key": key, "progress": p })); }).await
}

/// Apaga arquivos baixados. Só remove arquivos de áudio dentro de uma das pastas informadas, nunca outro caminho.
#[tauri::command]
pub fn download_delete(paths: Vec<String>, folder: String, app: tauri::AppHandle) -> Res<usize> {
    let root = resolve_folder(&app, &folder)?;
    Ok(delete_files(&paths, &root))
}

pub fn delete_files(paths: &[String], root: &Path) -> usize {
    let Ok(root) = root.canonicalize() else { return 0 };
    paths.iter().filter(|p| {
        let path = Path::new(p);
        let Ok(c) = path.canonicalize() else { return false };
        // só dentro da pasta de downloads e só áudio: o app nunca apaga outros arquivos
        c.starts_with(&root) && crate::local::is_playable(&c) && std::fs::remove_file(&c).is_ok()
    }).count()
}

/// Quais dos caminhos já não existem (arquivo apagado por fora).
#[tauri::command]
pub fn download_missing(paths: Vec<String>) -> Vec<String> { paths.into_iter().filter(|p| !Path::new(p).is_file()).collect() }

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mm-dl-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn wav(secs: u32) -> Vec<u8> {
        let data = vec![0u8; (8000 * secs) as usize];
        let mut v = Vec::new();
        v.extend(b"RIFF"); v.extend((36 + data.len() as u32).to_le_bytes()); v.extend(b"WAVEfmt ");
        v.extend(16u32.to_le_bytes()); v.extend(1u16.to_le_bytes()); v.extend(1u16.to_le_bytes());
        v.extend(8000u32.to_le_bytes()); v.extend(8000u32.to_le_bytes()); v.extend(1u16.to_le_bytes()); v.extend(8u16.to_le_bytes());
        v.extend(b"data"); v.extend((data.len() as u32).to_le_bytes()); v.extend(data);
        v
    }

    /// Servidor local: `/a.wav` devolve o áudio, `/c.jpg` a capa; qualquer outro caminho 404.
    async fn server(audio: Vec<u8>) -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = l.accept().await else { return };
                let audio = audio.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = s.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let (status, body, mime) = match path.as_str() {
                        "/a.wav" => ("200 OK", audio, "audio/wav"),
                        "/c.jpg" => ("200 OK", [vec![0xFF, 0xD8, 0xFF, 0xE0], vec![7u8; 600]].concat(), "image/jpeg"),
                        _ => ("404 Not Found", vec![], "text/plain"),
                    };
                    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                    let _ = s.write_all(head.as_bytes()).await;
                    let _ = s.write_all(&body).await;
                });
            }
        });
        format!("http://{addr}")
    }

    fn stream(base: &str, id: &str) -> StreamInfo {
        StreamInfo { url: format!("{base}/a.wav"), headers: vec![], mime: "audio/wav".into(), codec: "pcm".into(), bitrate: 0, content_length: None, ext: "wav".into(),
            expires_at_ms: u64::MAX, source: "teste".into(), source_id: id.into(), segments: vec![], loudness_lufs: None }
    }

    #[test]
    fn nomes_de_arquivo_seguros() {
        assert_eq!(sanitize("AC/DC: Back In Black?"), "AC_DC_ Back In Black_");
        assert_eq!(sanitize("  ..oculto.. "), "oculto");
        assert_eq!(sanitize("///"), "___");
        assert_eq!(sanitize(""), "faixa");
        assert_eq!(sanitize(&"a".repeat(300)).len(), 120);
        let t = TrackInfo { title: "Sombra".into(), artists: vec!["Kaito Norte".into(), "Outro".into()], ..Default::default() };
        assert_eq!(file_stem(&t), "Kaito Norte - Sombra");
        assert_eq!(file_stem(&TrackInfo { title: "Só título".into(), ..Default::default() }), "Só título");
    }

    #[test]
    fn nome_repetido_ganha_numero() {
        let d = tmp("unico");
        assert_eq!(unique_path(&d, "A - B", "m4a"), d.join("A - B.m4a"));
        std::fs::write(d.join("A - B.m4a"), b"x").unwrap();
        std::fs::write(d.join("A - B (2).m4a"), b"x").unwrap();
        assert_eq!(unique_path(&d, "A - B", "m4a"), d.join("A - B (3).m4a"));
    }

    #[test]
    fn letra_em_lrc_ou_texto() {
        use crate::lyrics::{Line, Lyrics};
        let l = |t, text: &str| Line { t, end: t + 2.0, text: text.into(), words: vec![], bg: false, agent: None };
        let sync = Lyrics { synced: true, provider: "x".into(), lines: vec![l(1.5, "um"), l(65.25, "dois")] };
        assert_eq!(lyrics_text(&sync), "[00:01.50]um\n[01:05.25]dois");
        let plain = Lyrics { synced: false, provider: "x".into(), lines: vec![l(0.0, "um"), l(0.0, "dois")] };
        assert_eq!(lyrics_text(&plain), "um\ndois");
    }

    #[tokio::test]
    async fn baixa_grava_tags_e_capa() {
        let d = tmp("pipeline");
        let base = server(wav(2)).await;
        let cache = Cache::open(d.join("cache"), 100);
        let track = TrackInfo { provider: "teste".into(), id: "1".into(), title: "Sombra de Papel".into(), artists: vec!["Kaito Norte".into()], album: Some("Noites".into()),
            artwork_url: Some(format!("{base}/c.jpg")), ..Default::default() };
        let progresses = std::sync::Mutex::new(vec![]);
        let done = download_stream(&cache, &track, stream(&base, "1"), None, &d.join("saida"), &Options { write_tags: true, embed_lyrics: false }, |p| progresses.lock().unwrap().push(p)).await.unwrap();
        assert!(done.path.ends_with("Kaito Norte - Sombra de Papel.wav"), "{}", done.path);
        assert!(done.tag_warning.is_none(), "{:?}", done.tag_warning);
        assert_eq!(*progresses.lock().unwrap().last().unwrap(), 1.0);
        // o arquivo salvo é o áudio mais as tags
        let t = crate::local::read_track(Path::new(&done.path), &d.join("covers"), true).unwrap();
        assert_eq!((t.title.as_str(), t.album.as_deref()), ("Sombra de Papel", Some("Noites")));
        assert_eq!(t.artists, vec!["Kaito Norte"]);
        assert_eq!(t.duration_ms, Some(2000));
        assert!(t.cover.is_some(), "a capa baixada deveria estar no arquivo");
        // de novo: não sobrescreve
        let again = download_stream(&cache, &track, stream(&base, "1"), None, &d.join("saida"), &Options::default(), |_| {}).await.unwrap();
        assert!(again.path.ends_with("Kaito Norte - Sombra de Papel (2).wav"), "{}", again.path);
        assert_eq!(std::fs::read_dir(d.join("saida")).unwrap().count(), 2, "sem sobras de .part");
    }

    #[tokio::test]
    async fn sem_tags_o_arquivo_fica_como_veio() {
        let d = tmp("semtags");
        let base = server(wav(1)).await;
        let cache = Cache::open(d.join("cache"), 100);
        let track = TrackInfo { provider: "teste".into(), id: "2".into(), title: "Faixa".into(), artists: vec!["Ana".into()], ..Default::default() };
        let done = download_stream(&cache, &track, stream(&base, "2"), None, &d.join("saida"), &Options::default(), |_| {}).await.unwrap();
        assert_eq!(std::fs::read(&done.path).unwrap(), wav(1));
    }

    #[tokio::test]
    async fn falha_de_rede_vira_erro() {
        let d = tmp("erro");
        let base = server(vec![]).await;
        let cache = Cache::open(d.join("cache"), 100);
        let mut s = stream(&base, "3");
        s.url = format!("{base}/nao-existe");
        let track = TrackInfo { provider: "teste".into(), id: "3".into(), title: "X".into(), ..Default::default() };
        let r = download_stream(&cache, &track, s, None, &d.join("saida"), &Options::default(), |_| {}).await;
        assert!(r.is_err());
        assert!(std::fs::read_dir(d.join("saida")).map(|r| r.count()).unwrap_or(0) == 0);
    }

    #[test]
    fn apagar_so_audio_dentro_da_pasta() {
        let d = tmp("apagar");
        let root = d.join("MetroMusic");
        std::fs::create_dir_all(&root).unwrap();
        let dentro = root.join("a.m4a"); std::fs::write(&dentro, b"x").unwrap();
        let nao_audio = root.join("nota.txt"); std::fs::write(&nao_audio, b"x").unwrap();
        let fora = d.join("fora.m4a"); std::fs::write(&fora, b"x").unwrap();
        let disfarce = root.join("..").join("fora.m4a");
        let n = delete_files(&[dentro.to_string_lossy().into(), nao_audio.to_string_lossy().into(), fora.to_string_lossy().into(), disfarce.to_string_lossy().into()], &root);
        assert_eq!(n, 1);
        assert!(!dentro.exists() && nao_audio.exists() && fora.exists());
    }

    #[test]
    fn arquivos_sumidos_sao_detectados() {
        let d = tmp("sumido");
        let ok = d.join("a.m4a"); std::fs::write(&ok, b"x").unwrap();
        let faltando = d.join("b.m4a");
        assert_eq!(download_missing(vec![ok.to_string_lossy().into(), faltando.to_string_lossy().into()]), vec![faltando.to_string_lossy().to_string()]);
    }
}
