//! Biblioteca local: varre pastas, lê as tags (lofty), extrai a capa e as letras, e vigia mudanças.
//! Os arquivos são tocados como qualquer fonte (`provider = "local"`, `id` = caminho do arquivo).

use crate::model::{now_ms, Res, StreamInfo, TrackInfo};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::{Accessor, ItemKey};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::Emitter;

/// Extensões que o decodificador do app lê. Opus, AIFF e WMA ficam de fora (ver `unsupported`).
const PLAYABLE: [&str; 8] = ["mp3", "flac", "m4a", "mp4", "aac", "ogg", "oga", "wav"];
const UNSUPPORTED: [&str; 4] = ["opus", "aiff", "aif", "wma"];
const COVER_NAMES: [&str; 8] = ["cover", "folder", "front", "album", "albumart", "artwork", "thumb", "poster"];

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalTrack {
    pub path: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
    pub track_no: Option<u32>,
    /// Caminho de uma imagem da capa (extraída do arquivo ou da pasta).
    pub cover: Option<String>,
    pub bitrate: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub tracks: Vec<LocalTrack>,
    /// Arquivos de áudio que o app não consegue tocar (Opus, AIFF, WMA).
    pub unsupported: usize,
    /// Arquivos que não puderam ser lidos.
    pub unreadable: usize,
    /// Arquivos curtos demais, descartados por `minDuration`.
    pub too_short: usize,
}

pub fn ext_of(path: &Path) -> String { path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase() }

pub fn is_playable(path: &Path) -> bool { PLAYABLE.contains(&ext_of(path).as_str()) }

fn hash(s: &str) -> String { Sha256::digest(s.as_bytes()).iter().take(10).map(|b| format!("{b:02x}")).collect() }

/// Separa vários artistas gravados numa tag só (`A; B`, ou separados por NUL como no ID3v2.4).
pub fn split_artists(s: &str) -> Vec<String> {
    s.split(|c| c == ';' || c == '\0').map(str::trim).filter(|a| !a.is_empty()).map(String::from).collect()
}

fn image_ext(mime: Option<&str>, data: &[u8]) -> &'static str {
    match mime { Some(m) if m.contains("png") => "png", Some(m) if m.contains("jpeg") || m.contains("jpg") => "jpg", _ => if data.starts_with(&[0x89, b'P', b'N', b'G']) { "png" } else { "jpg" } }
}

/// Imagem de capa na pasta do arquivo (`cover.jpg`, `folder.png`…).
pub fn folder_cover(dir: &Path) -> Option<PathBuf> {
    let rd = std::fs::read_dir(dir).ok()?;
    let mut found: Vec<(usize, PathBuf)> = rd.flatten().filter_map(|f| {
        let p = f.path();
        if !matches!(ext_of(&p).as_str(), "jpg" | "jpeg" | "png") { return None; }
        let stem = p.file_stem()?.to_str()?.to_ascii_lowercase();
        COVER_NAMES.iter().position(|n| *n == stem).map(|i| (i, p))
    }).collect();
    found.sort_by_key(|(i, _)| *i);
    found.into_iter().next().map(|(_, p)| p)
}

/// Lê tags e propriedades de um arquivo. `covers_dir`: onde gravar a capa embutida.
pub fn read_track(path: &Path, covers_dir: &Path, prefer_embedded: bool) -> Res<LocalTrack> {
    let tagged = lofty::read_from_path(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let props = tagged.properties();
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let mut t = LocalTrack {
        path: path.to_string_lossy().into_owned(),
        title: tag.and_then(|t| t.title().map(|s| s.trim().to_string())).filter(|s| !s.is_empty()).unwrap_or(stem),
        artists: tag.and_then(|t| t.artist().map(|a| split_artists(&a))).unwrap_or_default(),
        album: tag.and_then(|t| t.album().map(|s| s.trim().to_string())).filter(|s| !s.is_empty()),
        duration_ms: Some(props.duration().as_millis() as u64).filter(|d| *d > 0),
        track_no: tag.and_then(|t| t.track()),
        cover: None,
        bitrate: props.audio_bitrate().map(|b| b * 1000),
    };
    let embedded = tag.and_then(|t| t.pictures().first().cloned());
    let from_folder = || -> Option<String> {
        let src = path.parent().and_then(folder_cover)?;
        let mtime = std::fs::metadata(&src).and_then(|m| m.modified()).ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        let out = covers_dir.join(format!("{}-{mtime}.{}", hash(&src.to_string_lossy()), ext_of(&src)));
        if !out.exists() { std::fs::create_dir_all(covers_dir).ok()?; std::fs::copy(&src, &out).ok()?; }
        Some(out.to_string_lossy().into_owned())
    };
    let from_tag = |pic: &lofty::picture::Picture| -> Option<String> {
        let mtime = std::fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        let out = covers_dir.join(format!("{}-{mtime}.{}", hash(&t.path), image_ext(pic.mime_type().map(|m| m.as_str()), pic.data())));
        if !out.exists() { std::fs::create_dir_all(covers_dir).ok()?; std::fs::write(&out, pic.data()).ok()?; }
        Some(out.to_string_lossy().into_owned())
    };
    t.cover = if prefer_embedded { embedded.as_ref().and_then(from_tag).or_else(from_folder) } else { from_folder().or_else(|| embedded.as_ref().and_then(from_tag)) };
    Ok(t)
}

/// Varre as pastas (recursivo) e lê cada arquivo de áudio tocável.
pub fn scan(folders: &[String], min_secs: u64, prefer_embedded: bool, covers_dir: &Path) -> ScanResult {
    let mut out = ScanResult::default();
    let mut seen = std::collections::HashSet::new();
    for root in folders {
        for entry in walkdir::WalkDir::new(root).follow_links(false).into_iter().flatten() {
            if !entry.file_type().is_file() { continue; }
            let p = entry.path();
            let ext = ext_of(p);
            let listed = PLAYABLE.contains(&ext.as_str()) || UNSUPPORTED.contains(&ext.as_str());
            if !listed || !seen.insert(p.to_path_buf()) { continue; } // pastas que se sobrepõem não contam duas vezes
            if UNSUPPORTED.contains(&ext.as_str()) { out.unsupported += 1; continue; }
            match read_track(p, covers_dir, prefer_embedded) {
                Ok(t) => {
                    if min_secs > 0 && t.duration_ms.map_or(false, |d| d < min_secs * 1000) { out.too_short += 1; continue; }
                    out.tracks.push(t);
                }
                Err(_) => out.unreadable += 1,
            }
        }
    }
    out.tracks.sort_by(|a, b| (a.artists.first(), &a.album, a.track_no, &a.title).cmp(&(b.artists.first(), &b.album, b.track_no, &b.title)));
    out
}

fn mime_of(ext: &str) -> &'static str {
    match ext { "mp3" => "audio/mpeg", "flac" => "audio/flac", "m4a" | "mp4" | "aac" => "audio/mp4", "ogg" | "oga" => "audio/ogg", "wav" => "audio/wav", _ => "application/octet-stream" }
}

/// Faz o arquivo local passar pelo mesmo caminho dos outros streams: `source = "local"` e o motor lê direto do disco.
pub fn resolve(track: &TrackInfo) -> Res<StreamInfo> {
    let path = Path::new(&track.id);
    let md = std::fs::metadata(path).map_err(|_| format!("arquivo não encontrado: {}", track.id))?;
    if !md.is_file() { return Err(format!("não é um arquivo: {}", track.id)); }
    let ext = ext_of(path);
    if !PLAYABLE.contains(&ext.as_str()) { return Err(format!("formato .{ext} não é suportado pelo player")); }
    let codec = match ext.as_str() { "mp3" => "mp3", "flac" => "flac", "m4a" | "mp4" | "aac" => "aac", "ogg" | "oga" => "vorbis", "wav" => "pcm", _ => "" };
    Ok(StreamInfo {
        url: format!("file://{}", track.id), headers: vec![], mime: mime_of(&ext).into(), codec: codec.into(), bitrate: 0,
        content_length: Some(md.len()), ext, expires_at_ms: now_ms() + 365 * 24 * 3600 * 1000, source: "local".into(), source_id: track.id.clone(), segments: vec![], loudness_lufs: None,
    })
}

/// Letra do arquivo: `.lrc` com o mesmo nome ou a letra gravada na tag.
pub fn lyrics(path: &Path) -> Option<crate::lyrics::Lyrics> {
    use crate::lyrics::{parse_lrc, Lyrics};
    let sidecar = path.with_extension("lrc");
    let text = std::fs::read_to_string(&sidecar).ok().or_else(|| {
        let tagged = lofty::read_from_path(path).ok()?;
        let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
        tag.get_string(ItemKey::UnsyncLyrics).or_else(|| tag.get_string(ItemKey::Lyrics)).map(String::from)
    })?;
    let lines = parse_lrc(&text);
    if !lines.is_empty() { return Some(Lyrics { synced: true, provider: "Arquivo".into(), lines }); }
    let plain = crate::lyrics::plain_lines(&text);
    (!plain.is_empty()).then(|| Lyrics { synced: false, provider: "Arquivo".into(), lines: plain })
}

// ───────── Vigia das pastas

static WATCHER: Lazy<Mutex<Option<notify::RecommendedWatcher>>> = Lazy::new(|| Mutex::new(None));

/// Cria o vigia: chama `on_change` quando entra, sai ou é renomeado um áudio (ou `.lrc`); rajadas viram uma chamada só.
pub fn make_watcher(folders: &[String], on_change: impl Fn() + Send + 'static) -> Res<notify::RecommendedWatcher> {
    use notify::{RecursiveMode, Watcher};
    let last = std::sync::Arc::new(Mutex::new(0u64));
    let mut w = notify::recommended_watcher(move |ev: notify::Result<notify::Event>| {
        let Ok(ev) = ev else { return };
        if !matches!(ev.kind, notify::EventKind::Create(_) | notify::EventKind::Remove(_) | notify::EventKind::Modify(notify::event::ModifyKind::Name(_))) { return; }
        if !ev.paths.iter().any(|p| { let e = ext_of(p); PLAYABLE.contains(&e.as_str()) || UNSUPPORTED.contains(&e.as_str()) || e == "lrc" }) { return; }
        let mut l = last.lock();
        let now = now_ms();
        if now - *l < 2000 { return; }
        *l = now;
        on_change();
    }).map_err(|e| format!("não consegui vigiar as pastas: {e}"))?;
    for f in folders { if Path::new(f).is_dir() { let _ = w.watch(Path::new(f), RecursiveMode::Recursive); } }
    Ok(w)
}

/// Liga (ou desliga, com lista vazia) o vigia. Emite `local:changed` um pouco depois da mudança, para o arquivo terminar de ser copiado.
pub fn watch(app: tauri::AppHandle, folders: &[String]) -> Res<()> {
    let mut g = WATCHER.lock();
    *g = None;
    if folders.is_empty() { return Ok(()); }
    *g = Some(make_watcher(folders, move || {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { tokio::time::sleep(std::time::Duration::from_millis(1500)).await; let _ = app.emit("local:changed", ()); });
    })?);
    Ok(())
}

#[tauri::command]
pub async fn local_scan(app: tauri::AppHandle, folders: Vec<String>, min_secs: u64, prefer_embedded: bool) -> Res<ScanResult> {
    use tauri::Manager;
    let covers = app.path().app_data_dir().map_err(|e| e.to_string())?.join("covers");
    let index = app.path().app_data_dir().map_err(|e| e.to_string())?.join("local-index.json");
    let r = tauri::async_runtime::spawn_blocking(move || scan(&folders, min_secs, prefer_embedded, &covers)).await.map_err(|e| e.to_string())?;
    // o índice fica em disco para a biblioteca aparecer na hora ao abrir o app, sem varrer de novo
    let _ = std::fs::write(&index, serde_json::to_vec(&r).unwrap_or_default());
    Ok(r)
}

/// Biblioteca da última varredura (vazia se nunca houve).
#[tauri::command]
pub fn local_index_load(app: tauri::AppHandle) -> Option<ScanResult> {
    use tauri::Manager;
    let p = app.path().app_data_dir().ok()?.join("local-index.json");
    serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

/// Lê as tags de arquivos específicos (importação de M3U com caminhos locais). `None` = não existe ou não toca.
#[tauri::command]
pub async fn local_probe(app: tauri::AppHandle, paths: Vec<String>, prefer_embedded: bool) -> Res<Vec<Option<LocalTrack>>> {
    use tauri::Manager;
    let covers = app.path().app_data_dir().map_err(|e| e.to_string())?.join("covers");
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| { let p = Path::new(p); if p.is_file() && is_playable(p) { read_track(p, &covers, prefer_embedded).ok() } else { None } }).collect()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_watch(app: tauri::AppHandle, folders: Vec<String>) -> Res<()> { watch(app, &folders) }

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mm-local-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// WAV mono 8 kHz de silêncio com `secs` segundos.
    fn wav(secs: u32) -> Vec<u8> {
        let data = vec![0u8; (8000 * secs) as usize];
        let mut v = Vec::new();
        v.extend(b"RIFF"); v.extend((36 + data.len() as u32).to_le_bytes()); v.extend(b"WAVEfmt ");
        v.extend(16u32.to_le_bytes()); v.extend(1u16.to_le_bytes()); v.extend(1u16.to_le_bytes());
        v.extend(8000u32.to_le_bytes()); v.extend(8000u32.to_le_bytes()); v.extend(1u16.to_le_bytes()); v.extend(8u16.to_le_bytes());
        v.extend(b"data"); v.extend((data.len() as u32).to_le_bytes()); v.extend(data);
        v
    }

    fn tag_wav(path: &Path, title: &str, artist: &str, album: &str, lyrics: Option<&str>, cover: bool) {
        crate::tagging::write(path, &crate::tagging::TagData {
            title: title.into(), artists: split_artists(artist), album: Some(album.into()), track_no: Some(3),
            cover: cover.then(|| vec![0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]), lyrics: lyrics.map(String::from),
        }).expect("gravar tags");
    }

    #[test]
    fn artistas_separados() {
        assert_eq!(split_artists("Ana; Beto ;;Caio"), vec!["Ana", "Beto", "Caio"]);
        assert_eq!(split_artists("Solo"), vec!["Solo"]);
        assert!(split_artists("  ").is_empty());
    }

    #[test]
    fn le_tags_duracao_e_extrai_a_capa_embutida() {
        let d = tmp("tags");
        let f = d.join("musica.wav");
        std::fs::write(&f, wav(3)).unwrap();
        tag_wav(&f, "Sombra", "Kaito; Norte", "Noites", None, true);
        let t = read_track(&f, &d.join("covers"), true).unwrap();
        assert_eq!((t.title.as_str(), t.album.as_deref(), t.track_no), ("Sombra", Some("Noites"), Some(3)));
        assert_eq!(t.artists, vec!["Kaito", "Norte"]);
        assert_eq!(t.duration_ms, Some(3000));
        let cover = t.cover.expect("capa extraída");
        assert!(cover.contains("covers") && std::fs::read(&cover).unwrap().starts_with(&[0xFF, 0xD8]));
    }

    #[test]
    fn sem_tags_usa_o_nome_do_arquivo_e_a_capa_da_pasta() {
        let d = tmp("semtags");
        let f = d.join("Faixa Sem Tag.wav");
        std::fs::write(&f, wav(2)).unwrap();
        std::fs::write(d.join("Folder.JPG"), b"x").unwrap();
        let t = read_track(&f, &d.join("covers"), true).unwrap();
        assert_eq!(t.title, "Faixa Sem Tag");
        assert!(t.artists.is_empty());
        let c = t.cover.unwrap();
        assert!(c.contains("covers") && c.ends_with(".jpg"), "{c}"); // copiada para a pasta de capas do app
    }

    #[test]
    fn preferir_capa_embutida_ou_da_pasta() {
        let d = tmp("capa");
        let f = d.join("a.wav");
        std::fs::write(&f, wav(2)).unwrap();
        tag_wav(&f, "A", "B", "C", None, true);
        std::fs::write(d.join("cover.png"), b"x").unwrap();
        assert!(read_track(&f, &d.join("c"), true).unwrap().cover.unwrap().contains("/c/"));
        assert!(read_track(&f, &d.join("c"), false).unwrap().cover.unwrap().ends_with(".png"));
    }

    #[test]
    fn varredura_conta_o_que_pulou() {
        let d = tmp("scan");
        std::fs::create_dir_all(d.join("sub/fundo")).unwrap();
        std::fs::write(d.join("longa.wav"), wav(40)).unwrap();
        std::fs::write(d.join("sub/media.wav"), wav(12)).unwrap();
        std::fs::write(d.join("sub/fundo/curta.wav"), wav(3)).unwrap();
        std::fs::write(d.join("sub/musica.opus"), b"OggS").unwrap();
        std::fs::write(d.join("sub/quebrada.mp3"), b"isto nao e mp3").unwrap();
        std::fs::write(d.join("sub/nota.txt"), b"oi").unwrap();
        let r = scan(&[d.to_string_lossy().into_owned(), d.join("sub").to_string_lossy().into_owned()], 10, true, &d.join("covers"));
        assert_eq!(r.tracks.len(), 2, "pasta repetida não duplica");
        assert_eq!((r.too_short, r.unsupported, r.unreadable), (1, 1, 1));
        let tudo = scan(&[d.to_string_lossy().into_owned()], 0, true, &d.join("covers"));
        assert_eq!(tudo.tracks.len(), 3);
    }

    #[test]
    fn resolve_aponta_para_o_arquivo_e_recusa_o_que_nao_toca() {
        let d = tmp("resolve");
        let f = d.join("x.wav");
        std::fs::write(&f, wav(1)).unwrap();
        let tr = TrackInfo { provider: "local".into(), id: f.to_string_lossy().into_owned(), ..Default::default() };
        let s = resolve(&tr).unwrap();
        assert_eq!((s.source.as_str(), s.codec.as_str(), s.ext.as_str()), ("local", "pcm", "wav"));
        assert_eq!(s.source_id, tr.id);
        assert!(s.content_length.unwrap() > 8000);
        assert!(resolve(&TrackInfo { provider: "local".into(), id: d.join("nao-existe.wav").to_string_lossy().into_owned(), ..Default::default() }).is_err());
        let o = d.join("a.opus"); std::fs::write(&o, b"x").unwrap();
        assert!(resolve(&TrackInfo { provider: "local".into(), id: o.to_string_lossy().into_owned(), ..Default::default() }).is_err());
    }

    #[test]
    fn letra_do_lrc_ao_lado_ou_da_tag() {
        let d = tmp("letra");
        let f = d.join("m.wav");
        std::fs::write(&f, wav(2)).unwrap();
        assert!(lyrics(&f).is_none());
        tag_wav(&f, "M", "N", "O", Some("primeira linha\nsegunda linha"), false);
        let l = lyrics(&f).expect("letra da tag");
        assert!(!l.synced && l.lines.len() == 2);
        std::fs::write(d.join("m.lrc"), "[00:01.00]sincronizada um\n[00:04.00]sincronizada dois\n").unwrap();
        let l = lyrics(&f).expect("lrc tem prioridade");
        assert!(l.synced && l.lines[0].text == "sincronizada um" && l.lines[0].t == 1.0);
    }

    #[test]
    fn motor_le_o_arquivo_local_e_o_cache_nunca_o_apaga() {
        use std::io::Read;
        let d = tmp("externo");
        let f = d.join("m.wav");
        std::fs::write(&f, wav(2)).unwrap();
        let cache = crate::cache::Cache::open(d.join("cache"), 1);
        let s = resolve(&TrackInfo { provider: "local".into(), id: f.to_string_lossy().into_owned(), ..Default::default() }).unwrap();
        let e = cache.external_entry(&s);
        assert!(e.is_complete());
        let mut r = e.reader(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))).unwrap();
        let mut got = vec![];
        r.read_to_end(&mut got).unwrap();
        assert_eq!(got, std::fs::read(&f).unwrap());
        drop(r);
        // limite zero, limpeza total: o arquivo do usuário continua lá
        cache.set_limit_mb(0);
        cache.trim(&std::collections::HashSet::new());
        cache.clear(&std::collections::HashSet::new());
        assert!(f.exists());
    }

    #[test]
    fn vigia_avisa_quando_entra_e_sai_audio_e_ignora_o_resto() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let d = tmp("vigia");
        let sub = d.join("album"); std::fs::create_dir_all(&sub).unwrap();
        let hits = std::sync::Arc::new(AtomicUsize::new(0));
        let h2 = hits.clone();
        let _w = make_watcher(&[d.to_string_lossy().into_owned()], move || { h2.fetch_add(1, Ordering::SeqCst); }).unwrap();
        let wait = |n: usize| { for _ in 0..60 { if hits.load(Ordering::SeqCst) >= n { return true; } std::thread::sleep(std::time::Duration::from_millis(100)); } false };
        std::thread::sleep(std::time::Duration::from_millis(300));
        // arquivo que não é áudio: nada
        std::fs::write(sub.join("capa.txt"), b"x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(800));
        assert_eq!(hits.load(Ordering::SeqCst), 0, "texto não deveria avisar");
        // áudio novo numa subpasta: avisa
        std::fs::write(sub.join("nova.wav"), wav(1)).unwrap();
        assert!(wait(1), "áudio novo deveria avisar");
        // passada a janela de 2 s, apagar o áudio também avisa
        std::thread::sleep(std::time::Duration::from_millis(2200));
        std::fs::remove_file(sub.join("nova.wav")).unwrap();
        assert!(wait(2), "áudio removido deveria avisar");
    }
}
