//! SoundCloud pela API v2 pública. Porte de `SoundCloudAudioProvider` (MetroFuse):
//! o `client_id` é extraído do próprio site, faixas só-trecho (`SNIP`) são descartadas e o
//! áudio é o transcoding progressivo (MP3), que o decodificador consegue ler em sequência.

use crate::http::{err, BROWSER_UA, CLIENT};
use crate::model::{now_ms, Res, StreamInfo, TrackInfo};
use once_cell::sync::Lazy;
use parking_lot::Mutex as SyncMutex;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use tokio::sync::Mutex;

const API: &str = "https://api-v2.soundcloud.com";
const META_TTL_MS: u64 = 12 * 60 * 60 * 1000;
const STREAM_CACHE_MS: u64 = 5 * 60 * 1000;

static ASSET_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"https://[a-z0-9-]+\.sndcdn\.com/[^"'<>!]+\.js"#).unwrap());
static CLIENT_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)client_?id["']?\s*[:=]\s*["']([A-Za-z0-9]{20,})["']"#).unwrap());
static APP_VERSION_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)app_?version["']?\s*[:=]\s*["']([0-9]{8,})["']"#).unwrap());

#[derive(Clone)]
struct Meta {
    client_id: String,
    app_version: Option<String>,
    expires_at: u64,
}
static META: Lazy<Mutex<Option<Meta>>> = Lazy::new(|| Mutex::new(None));
static STREAMS: Lazy<SyncMutex<HashMap<String, StreamInfo>>> = Lazy::new(|| SyncMutex::new(HashMap::new()));

async fn fetch_text(url: &str) -> String {
    match CLIENT.get(url).header("User-Agent", BROWSER_UA).send().await {
        Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
        _ => String::new(),
    }
}

async fn scrape() -> Res<Meta> {
    let html = fetch_text("https://soundcloud.com").await;
    let mut client_id = CLIENT_ID_RE.captures(&html).map(|c| c[1].to_string());
    let mut app_version = APP_VERSION_RE.captures(&html).map(|c| c[1].to_string());
    if client_id.is_none() || app_version.is_none() {
        let mut urls: Vec<String> = ASSET_RE.find_iter(&html).map(|m| m.as_str().to_string()).collect();
        urls.sort();
        urls.dedup();
        // Os pacotes JS são baixados em paralelo, como no MetroFuse, para reduzir a espera.
        let scripts = futures_util::future::join_all(urls.iter().map(|u| fetch_text(u))).await;
        for js in scripts {
            if client_id.is_none() { client_id = CLIENT_ID_RE.captures(&js).map(|c| c[1].to_string()); }
            if app_version.is_none() { app_version = APP_VERSION_RE.captures(&js).map(|c| c[1].to_string()); }
            if client_id.is_some() && app_version.is_some() { break; }
        }
    }
    let client_id = client_id.ok_or("SoundCloud: não foi possível obter o client_id")?;
    Ok(Meta { client_id, app_version, expires_at: now_ms() + META_TTL_MS })
}

async fn meta(force: bool) -> Res<Meta> {
    let mut guard = META.lock().await;
    if !force {
        if let Some(m) = guard.as_ref().filter(|m| m.expires_at > now_ms()) {
            return Ok(m.clone());
        }
    }
    let m = scrape().await?;
    *guard = Some(m.clone());
    Ok(m)
}

/// GET na API v2 com `client_id` e `app_version`. Se o `client_id` foi revogado, raspa de novo e repete uma vez.
async fn api(url: &str, params: &[(&str, String)]) -> Res<Value> {
    for attempt in 0..2 {
        let m = meta(attempt == 1).await?;
        let mut q: Vec<(&str, String)> = params.to_vec();
        q.push(("client_id", m.client_id.clone()));
        q.push(("app_locale", "en".into()));
        if let Some(v) = &m.app_version { q.push(("app_version", v.clone())); }
        let resp = CLIENT
            .get(url)
            .query(&q)
            .header("Accept", "application/json")
            .header("Referer", "https://soundcloud.com/")
            .header("Origin", "https://soundcloud.com")
            .header("User-Agent", BROWSER_UA)
            .send().await.map_err(err)?;
        let status = resp.status();
        if matches!(status.as_u16(), 401 | 403 | 429) && attempt == 0 {
            continue;
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("SoundCloud HTTP {status}: {}", body.chars().take(160).collect::<String>()));
        }
        return resp.json().await.map_err(err);
    }
    Err("SoundCloud: client_id recusado".into())
}

fn split_artists(s: &str) -> Vec<String> {
    static SEP: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\s*(?:,|&|\sx\s|\sfeat\.?\s|\sft\.?\s|\swith\s)\s*").unwrap());
    SEP.split(s).map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
}

fn text(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string)
}

fn to_track(v: &Value) -> Option<TrackInfo> {
    if v.get("kind").and_then(|k| k.as_str()) != Some("track") { return None; }
    if v.get("streamable").and_then(|s| s.as_bool()) == Some(false) { return None; }
    // `SNIP` é só um trecho de faixa paga; não há nada completo para tocar.
    if text(v, "policy").map_or(false, |p| p.eq_ignore_ascii_case("SNIP")) { return None; }
    let id = v.get("id").and_then(|x| x.as_u64()).map(|x| x.to_string())?;
    let title = text(v, "title")?;
    let publisher = v.get("publisher_metadata");
    let mut artists: Vec<String> = Vec::new();
    for name in [
        publisher.and_then(|p| text(p, "artist")),
        v.get("user").and_then(|u| text(u, "username")),
        text(v, "label_name"),
    ].into_iter().flatten() {
        for a in split_artists(&name) {
            if !artists.iter().any(|x| x.eq_ignore_ascii_case(&a)) { artists.push(a); }
        }
    }
    if artists.is_empty() { artists.push("Artista desconhecido".into()); }
    let duration = v.get("full_duration").and_then(|d| d.as_u64()).or_else(|| v.get("duration").and_then(|d| d.as_u64()));
    // As miniaturas vêm em 100x100 ("-large"); a versão grande troca o sufixo.
    let artwork = text(v, "artwork_url").map(|u| u.replace("-large.", "-t500x500."));
    Some(TrackInfo {
        provider: "soundcloud".into(),
        id,
        title,
        artists,
        album: publisher.and_then(|p| text(p, "album_title")),
        duration_ms: duration,
        isrc: publisher.and_then(|p| text(p, "isrc")),
        artwork_url: artwork,
        explicit: publisher.and_then(|p| p.get("explicit")).and_then(|x| x.as_bool()).unwrap_or(false),
        url: text(v, "permalink_url"),
        preview_url: None,
        ..Default::default()
    })
}

pub async fn search(query: &str, limit: usize) -> Res<Vec<TrackInfo>> {
    if query.trim().is_empty() { return Ok(vec![]); }
    let v = api(&format!("{API}/search/tracks"), &[("q", query.to_string()), ("limit", limit.clamp(1, 50).to_string())]).await?;
    Ok(v.get("collection").and_then(|c| c.as_array()).map(|a| a.iter().filter_map(to_track).collect()).unwrap_or_default())
}

struct Candidate {
    url: String,
    mime: String,
    bitrate: u32,
    progressive: bool,
}

/// Lê uma playlist HLS e devolve as URLs na ordem: segmento de inicialização (EXT-X-MAP) e segmentos.
pub(crate) fn parse_playlist(base: &str, text: &str) -> Vec<String> {
    let base = reqwest::Url::parse(base).ok();
    let abs = |u: &str| match &base { Some(b) => b.join(u).map(|x| x.to_string()).unwrap_or_else(|_| u.to_string()), None => u.to_string() };
    let mut out = vec![];
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some(rest) = line.strip_prefix("#EXT-X-MAP:") {
            if let Some(uri) = rest.split(',').find_map(|kv| kv.trim().strip_prefix("URI=")) { out.push(abs(uri.trim_matches('"'))); }
        } else if !line.starts_with('#') {
            out.push(abs(line));
        }
    }
    out
}

fn pick_transcoding(track: &Value) -> Option<Candidate> {
    let list = track.get("media")?.get("transcodings")?.as_array()?;
    let mut out: Vec<Candidate> = list.iter().filter_map(|t| {
        let fmt = t.get("format")?;
        let protocol = fmt.get("protocol")?.as_str()?.to_lowercase();
        let mime = fmt.get("mime_type")?.as_str()?.to_lowercase();
        let supported = mime.contains("mpeg") || mime.contains("mp3") || mime.contains("aac") || mime.contains("mp4");
        if !supported || !matches!(protocol.as_str(), "progressive" | "hls") { return None; }
        let preset = t.get("preset").and_then(|p| p.as_str()).unwrap_or("");
        let bitrate = t.get("bitrate").or_else(|| fmt.get("bitrate")).and_then(|b| b.as_u64()).map(|b| b as u32)
            .unwrap_or(if preset.contains("160") { 160_000 } else if preset.contains("96") { 96_000 } else { 128_000 });
        Some(Candidate { url: t.get("url")?.as_str()?.to_string(), mime, bitrate, progressive: protocol == "progressive" })
    }).collect();
    // "audio/mpegurl" é só a lista genérica; o HLS útil é o AAC em MP4 fragmentado.
    out.retain(|c| c.progressive || c.mime.contains("mp4"));
    // AAC primeiro, depois a maior taxa; empate fica com o progressivo (um download só).
    out.sort_by_key(|c| (!c.mime.contains("mp4"), std::cmp::Reverse(c.bitrate), !c.progressive));
    out.into_iter().next()
}

pub async fn resolve(track: &TrackInfo) -> Res<StreamInfo> {
    if let Some(s) = STREAMS.lock().get(&track.id).filter(|s| s.expires_at_ms > now_ms() + 20_000).cloned() {
        return Ok(s);
    }
    let full = api(&format!("{API}/tracks/{}", track.id), &[]).await?;
    if text(&full, "policy").map_or(false, |p| p.eq_ignore_ascii_case("SNIP")) {
        return Err("SoundCloud: faixa disponível só como trecho".into());
    }
    let cand = pick_transcoding(&full).ok_or_else(|| {
        let offered: Vec<String> = full.get("media").and_then(|m| m.get("transcodings")).and_then(|t| t.as_array()).into_iter().flatten()
            .filter_map(|t| t.get("format").map(|f| format!("{} {}", f["protocol"].as_str().unwrap_or("?"), f["mime_type"].as_str().unwrap_or("?")))).collect();
        format!("SoundCloud: nenhum stream progressivo disponível (oferecidos: {})", offered.join(", "))
    })?;
    let mut params: Vec<(&str, String)> = vec![];
    if let Some(auth) = text(&full, "track_authorization") { params.push(("track_authorization", auth)); }
    let resolved = api(&cand.url, &params).await?;
    let url = text(&resolved, "url").ok_or("SoundCloud: resposta sem URL de stream")?;
    let is_mp3 = cand.mime.contains("mpeg") || cand.mime.contains("mp3");
    let segments = if cand.progressive { vec![] } else {
        let playlist = CLIENT.get(&url).header("User-Agent", BROWSER_UA).header("Referer", "https://soundcloud.com/").send().await.map_err(err)?
            .error_for_status().map_err(err)?.text().await.map_err(err)?;
        let list = parse_playlist(&url, &playlist);
        if list.len() < 2 { return Err("SoundCloud: playlist HLS vazia".into()); }
        list
    };
    let info = StreamInfo {
        url,
        headers: vec![
            ("User-Agent".into(), BROWSER_UA.into()),
            ("Accept".into(), "audio/*,*/*;q=0.8".into()),
            ("Accept-Encoding".into(), "identity".into()),
            ("Referer".into(), "https://soundcloud.com/".into()),
            ("Origin".into(), "https://soundcloud.com".into()),
        ],
        mime: cand.mime.clone(),
        codec: if is_mp3 { "mp3".into() } else { "aac".into() },
        bitrate: cand.bitrate,
        content_length: None,
        ext: if is_mp3 { "mp3".into() } else { "m4a".into() },
        expires_at_ms: now_ms() + STREAM_CACHE_MS,
        source: "soundcloud".into(),
        source_id: track.id.clone(),
        segments,
    };
    STREAMS.lock().insert(track.id.clone(), info.clone());
    Ok(info)
}

pub fn invalidate(id: &str) {
    STREAMS.lock().remove(id);
}

#[cfg(test)]
mod tests {
    use super::parse_playlist;
    #[test]
    fn playlist_hls_com_init_e_segmentos_relativos() {
        let txt = "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:9.9,\nseg0.m4s\n#EXTINF:9.9,\nhttps://cdn.x/seg1.m4s\n#EXT-X-ENDLIST\n";
        assert_eq!(parse_playlist("https://a.b/c/p.m3u8?x=1", txt), vec!["https://a.b/c/init.mp4", "https://a.b/c/seg0.m4s", "https://cdn.x/seg1.m4s"]);
    }
}
