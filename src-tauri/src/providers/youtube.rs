//! YouTube Music via InnerTube. Porte de `YouTubeAudioProvider` e `InnerTube` (MetroFuse).
//!
//! Só entram clientes que devolvem URL direta sem PO token (visionOS, iPadOS, Android VR,
//! Android Music), disparados em paralelo; vale o primeiro que responder. Não há decifragem de
//! assinatura nem emulação de BotGuard. Formatos Opus são ignorados porque o decodificador do
//! app não os lê: o AAC (m4a) é o preferido.

use crate::http::{err, BROWSER_UA, CLIENT};
use crate::model::{now_ms, Res, StreamInfo, TrackInfo};
use futures_util::stream::{FuturesUnordered, StreamExt};
use once_cell::sync::Lazy;
use parking_lot::Mutex as SyncMutex;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use tokio::sync::Mutex;

const API: &str = "https://music.youtube.com/youtubei/v1";
const ORIGIN_MUSIC: &str = "https://music.youtube.com";
const FILTER_SONG: &str = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";
const X_YOUTUBE_DEVICE: &str = "ONEPLUS_A6013";
const MIN_KBPS: u32 = 128;
const MAX_KBPS: u32 = 256;
const DEFAULT_STREAM_CACHE_MS: u64 = 5 * 60 * 1000;

pub struct Client {
    pub key: &'static str,
    name: &'static str,
    version: &'static str,
    id: &'static str,
    ua: &'static str,
    os_name: Option<&'static str>,
    os_version: Option<&'static str>,
    make: Option<&'static str>,
    model: Option<&'static str>,
    sdk: Option<&'static str>,
    api_format: &'static str,
}

pub(super) const WEB_REMIX: Client = Client {
    key: "web_remix", name: "WEB_REMIX", version: "1.20260213.01.00", id: "67",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
    os_name: None, os_version: None, make: None, model: None, sdk: None, api_format: "1",
};

/// Em ordem de confiabilidade (a mesma do MetroFuse).
const PLAYBACK_CLIENTS: [Client; 5] = [
    Client {
        key: "visionos", name: "VISIONOS", version: "1.02", id: "101",
        ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        os_name: Some("visionOS"), os_version: Some("26.5.23O471"), make: Some("Apple"), model: Some("RealityDevice17,1"), sdk: None, api_format: "2",
    },
    Client {
        key: "ipados", name: "IOS", version: "21.03.3", id: "5",
        ua: "com.google.ios.youtube/21.03.3 (iPad7,6; U; CPU iPadOS 17_7_10 like Mac OS X; en-US)",
        os_name: Some("iPadOS"), os_version: Some("17.7.10.21H450"), make: Some("Apple"), model: Some("iPad7,6"), sdk: None, api_format: "2",
    },
    Client {
        key: "android_vr_165", name: "ANDROID_VR", version: "1.65.10", id: "28",
        ua: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
        os_name: Some("Android"), os_version: Some("12L"), make: Some("Oculus"), model: Some("Quest 3"), sdk: Some("32"), api_format: "2",
    },
    Client {
        key: "android_vr_143", name: "ANDROID_VR", version: "1.43.32", id: "28",
        ua: "com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/107.0.5284.2)",
        os_name: Some("Android"), os_version: Some("12"), make: Some("Oculus"), model: Some("Quest 3"), sdk: Some("32"), api_format: "2",
    },
    Client {
        key: "android_music", name: "ANDROID_MUSIC", version: "7.02.52", id: "21",
        ua: "com.google.android.apps.youtube.music/7.02.52 (Linux; U; Android 14) gzip",
        os_name: None, os_version: None, make: None, model: None, sdk: None, api_format: "2",
    },
];

static VISITOR: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
static STREAMS: Lazy<SyncMutex<HashMap<String, StreamInfo>>> = Lazy::new(|| SyncMutex::new(HashMap::new()));
static VISITOR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^Cg[ts]").unwrap());

/// `visitorData` identifica a sessão anônima; vem do `sw.js_data` do YouTube Music.
pub(super) async fn visitor_data() -> Option<String> {
    let mut guard = VISITOR.lock().await;
    if guard.is_some() { return guard.clone(); }
    let body = CLIENT.get(format!("{ORIGIN_MUSIC}/sw.js_data")).header("User-Agent", BROWSER_UA).send().await.ok()?.text().await.ok()?;
    let json: Value = serde_json::from_str(body.get(5..)?).ok()?;
    let found = json.get(0)?.get(2)?.as_array()?.iter().filter_map(|v| v.as_str()).find(|s| VISITOR_RE.is_match(s)).map(str::to_string);
    *guard = found.clone();
    found
}

pub(super) fn context(c: &Client, visitor: &Option<String>) -> Value {
    let mut client = json!({ "clientName": c.name, "clientVersion": c.version, "gl": "US", "hl": "en", "visitorData": visitor });
    for (k, v) in [("osName", c.os_name), ("osVersion", c.os_version), ("deviceMake", c.make), ("deviceModel", c.model), ("androidSdkVersion", c.sdk)] {
        if let Some(v) = v { client[k] = json!(v); }
    }
    json!({ "client": client, "request": { "internalExperimentFlags": [], "useSsl": true }, "user": { "lockedSafetyMode": false } })
}

/// `auth`: assina a requisição com a sessão da conta, se houver uma.
pub(super) async fn post(endpoint: &str, c: &Client, visitor: &Option<String>, body: Value, auth: bool) -> Res<Value> {
    let mut req = CLIENT
        .post(format!("{API}/{endpoint}?prettyPrint=false"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("X-Goog-Api-Format-Version", c.api_format)
        .header("X-YouTube-Client-Name", c.id)
        .header("X-YouTube-Client-Version", c.version)
        .header("X-Goog-Client-Name", c.name)
        .header("X-Goog-Client-Version", c.version)
        .header("X-Origin", ORIGIN_MUSIC)
        .header("Referer", format!("{ORIGIN_MUSIC}/"))
        .header("X-YouTube-Device", X_YOUTUBE_DEVICE)
        .header("User-Agent", c.ua);
    if let Some(v) = c.os_name { req = req.header("X-Goog-OS-Name", v); }
    if let Some(v) = c.os_version { req = req.header("X-Goog-OS-Version", v); }
    if let Some(v) = c.sdk { req = req.header("X-Android-Sdk-Int", v); }
    if let Some(v) = visitor { req = req.header("X-Goog-Visitor-Id", v); }
    if auth { for (k, v) in super::auth::headers() { req = req.header(k, v); } }
    let resp = req.json(&body).send().await.map_err(err)?;
    let status = resp.status();
    if !status.is_success() { return Err(format!("InnerTube {endpoint} HTTP {status}")); }
    resp.json().await.map_err(err)
}

// ───────── Busca

/// Acesso por caminho: "a.b.0.c" (números indexam arrays).
pub(super) fn at<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.').try_fold(v, |cur, seg| match seg.parse::<usize>() {
        Ok(i) => cur.get(i),
        Err(_) => cur.get(seg),
    })
}

pub(super) fn parse_duration(s: &str) -> Option<u64> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d+(:\d{1,2}){1,2}$").unwrap());
    if !RE.is_match(s) { return None; }
    Some(s.split(':').fold(0u64, |acc, p| acc * 60 + p.parse::<u64>().unwrap_or(0)) * 1000)
}

pub(super) fn big_artwork(url: &str) -> String {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"=w\d+-h\d+").unwrap());
    RE.replace(url, "=w544-h544").to_string()
}

pub(super) fn parse_item(r: &Value) -> Option<TrackInfo> {
    let id = at(r, "playlistItemData.videoId")
        .or_else(|| at(r, "overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId"))
        .and_then(|v| v.as_str())?.to_string();
    let col = |i: usize| at(r, &format!("flexColumns.{i}.musicResponsiveListItemFlexColumnRenderer.text.runs"));
    let title = col(0)?.get(0)?.get("text")?.as_str()?.to_string();

    let (mut artists, mut album, mut duration) = (Vec::<String>::new(), None::<String>, None::<u64>);
    let mut loose: Vec<String> = vec![];
    for run in col(1).and_then(|r| r.as_array()).into_iter().flatten() {
        let text = run.get("text").and_then(|t| t.as_str()).unwrap_or("").trim().to_string();
        if text.is_empty() || text == "•" { continue; }
        let browse = at(run, "navigationEndpoint.browseEndpoint.browseId").and_then(|b| b.as_str()).unwrap_or("");
        if let Some(d) = parse_duration(&text) { duration = Some(d); }
        else if browse.starts_with("UC") { artists.push(text); }
        else if browse.starts_with("MPRE") { album = Some(text); }
        else if !matches!(text.as_str(), "Song" | "Video" | "Música" | "Vídeo") { loose.push(text); }
    }
    // Artistas sem link (ex.: "Vários artistas") aparecem como texto solto antes do álbum.
    if artists.is_empty() { if let Some(first) = loose.first() { artists.push(first.clone()); } }
    if artists.is_empty() { artists.push("Artista desconhecido".into()); }

    let artwork = at(r, "thumbnail.musicThumbnailRenderer.thumbnail.thumbnails")
        .and_then(|t| t.as_array()).and_then(|t| t.last()).and_then(|t| t.get("url")).and_then(|u| u.as_str()).map(big_artwork);
    let explicit = r.get("badges").and_then(|b| b.as_array()).map_or(false, |b| {
        b.iter().any(|x| at(x, "musicInlineBadgeRenderer.icon.iconType").and_then(|i| i.as_str()) == Some("MUSIC_EXPLICIT_BADGE"))
    });
    Some(TrackInfo {
        provider: "youtube".into(), url: Some(format!("https://music.youtube.com/watch?v={id}")), id, title, artists, album,
        duration_ms: duration, isrc: None, artwork_url: artwork, explicit, preview_url: None,
    })
}

pub async fn search(query: &str, limit: usize) -> Res<Vec<TrackInfo>> {
    if query.trim().is_empty() { return Ok(vec![]); }
    let visitor = visitor_data().await;
    let body = json!({ "context": context(&WEB_REMIX, &visitor), "query": query, "params": urlencoding::decode(FILTER_SONG).map(|c| c.into_owned()).unwrap_or_default() });
    let v = post("search", &WEB_REMIX, &visitor, body, false).await?;
    let sections = at(&v, "contents.tabbedSearchResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents").and_then(|c| c.as_array());
    let mut out = vec![];
    for sec in sections.into_iter().flatten() {
        for item in at(sec, "musicShelfRenderer.contents").and_then(|c| c.as_array()).into_iter().flatten() {
            if let Some(t) = item.get("musicResponsiveListItemRenderer").and_then(parse_item) { out.push(t); }
        }
    }
    out.truncate(limit.max(1));
    Ok(out)
}

// ───────── Stream

struct Format {
    url: String,
    mime: String,
    codec: String,
    bitrate: u32,
    content_length: Option<u64>,
    approx_duration_ms: Option<u64>,
}

fn clean_mime(m: &str) -> String { m.split(';').next().unwrap_or("").trim().to_string() }

fn codec_of(m: &str) -> String {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"codecs="([^"]+)""#).unwrap());
    RE.captures(m).map(|c| c[1].split(',').next().unwrap_or("").trim().to_string()).unwrap_or_default()
}

/// Escolhe o AAC (m4a) com URL direta, entre 128 e 256 kbps, descartando trechos de prévia.
fn pick_format(player: &Value, expected_ms: Option<u64>) -> Option<Format> {
    let formats = at(player, "streamingData.adaptiveFormats")?.as_array()?;
    let mut list: Vec<Format> = formats.iter().filter_map(|f| {
        let mime = f.get("mimeType")?.as_str()?;
        if !mime.starts_with("audio/") { return None; }
        let url = f.get("url")?.as_str()?.to_string(); // sem `signatureCipher`: não decifra assinatura
        let codec = codec_of(mime);
        if !codec.starts_with("mp4a") { return None; } // Opus não é decodificado pelo app
        let bitrate = f.get("averageBitrate").or_else(|| f.get("bitrate")).and_then(|b| b.as_u64()).unwrap_or(0) as u32;
        let approx = f.get("approxDurationMs").and_then(|a| a.as_str()).and_then(|a| a.parse::<u64>().ok());
        if let (Some(exp), Some(ap)) = (expected_ms, approx) { if ap * 10 < exp * 6 { return None; } } // prévia
        if bitrate / 1000 > MAX_KBPS { return None; }
        Some(Format {
            url, mime: clean_mime(mime), codec, bitrate,
            content_length: f.get("contentLength").and_then(|c| c.as_str()).and_then(|c| c.parse().ok()),
            approx_duration_ms: approx,
        })
    }).collect();
    let in_target = list.iter().any(|f| (MIN_KBPS..=MAX_KBPS).contains(&(f.bitrate / 1000)));
    if in_target { list.retain(|f| (MIN_KBPS..=MAX_KBPS).contains(&(f.bitrate / 1000))); }
    list.sort_by_key(|f| std::cmp::Reverse(f.bitrate));
    list.into_iter().next()
}

fn expiry_ms(url: &str, now: u64, api_secs: Option<u64>) -> u64 {
    let from_url = url.split(['?', '&']).find_map(|p| p.strip_prefix("expire=")).and_then(|e| e.parse::<u64>().ok()).map(|e| (e * 1000).saturating_sub(30_000));
    let from_api = api_secs.filter(|s| *s > 0).map(|s| now + s * 1000 - 30_000);
    [from_url, from_api, Some(now + DEFAULT_STREAM_CACHE_MS)].into_iter().flatten().min().unwrap_or(now + DEFAULT_STREAM_CACHE_MS).max(now + 30_000)
}

async fn attempt(c: &'static Client, video_id: &str, expected_ms: Option<u64>, visitor: &Option<String>) -> Res<StreamInfo> {
    let body = json!({ "context": context(c, visitor), "videoId": video_id, "playlistId": null, "contentCheckOk": true, "racyCheckOk": true });
    let player = post("player", c, visitor, body, false).await?;
    let status = at(&player, "playabilityStatus.status").and_then(|s| s.as_str()).unwrap_or("?");
    if status != "OK" { return Err(format!("{}: playabilidade={status}", c.key)); }
    let f = pick_format(&player, expected_ms).ok_or_else(|| format!("{}: sem formato AAC com URL direta", c.key))?;
    let now = now_ms();
    let expires = expiry_ms(&f.url, now, at(&player, "streamingData.expiresInSeconds").and_then(|e| e.as_str()).and_then(|e| e.parse().ok()));
    if expires <= now + 45_000 { return Err(format!("{}: URL expira cedo demais", c.key)); }
    Ok(StreamInfo {
        url: f.url, mime: f.mime, codec: f.codec, bitrate: f.bitrate, content_length: f.content_length, ext: "m4a".into(),
        expires_at_ms: expires, source: "youtube".into(), source_id: video_id.to_string(), segments: vec![],
        // A CDN confere o User-Agent: tem de ser o do cliente que gerou a URL.
        headers: vec![
            ("User-Agent".into(), c.ua.into()),
            ("Accept".into(), "*/*".into()),
            ("Accept-Encoding".into(), "identity".into()),
            ("Origin".into(), "https://www.youtube.com".into()),
            ("Referer".into(), "https://www.youtube.com/".into()),
            ("X-YouTube-Client-Name".into(), c.id.into()),
            ("X-YouTube-Client-Version".into(), c.version.into()),
            ("X-Goog-Api-Format-Version".into(), c.api_format.into()),
            ("X-YouTube-Device".into(), X_YOUTUBE_DEVICE.into()),
        ],
    })
}

/// Dispara todos os clientes em paralelo e fica com o primeiro stream utilizável.
pub async fn resolve(video_id: &str, expected_ms: Option<u64>) -> Res<StreamInfo> {
    if let Some(s) = STREAMS.lock().get(video_id).filter(|s| s.expires_at_ms > now_ms() + 30_000).cloned() { return Ok(s); }
    let visitor = visitor_data().await;
    let mut race: FuturesUnordered<_> = PLAYBACK_CLIENTS.iter().map(|c| attempt(c, video_id, expected_ms, &visitor)).collect();
    let mut failures: Vec<String> = vec![];
    while let Some(r) = race.next().await {
        match r {
            Ok(info) => { STREAMS.lock().insert(video_id.to_string(), info.clone()); return Ok(info); }
            Err(e) => failures.push(e),
        }
    }
    Err(format!("YouTube Music: nenhum stream para {video_id} ({})", failures.join("; ")))
}

pub fn invalidate(video_id: &str) { STREAMS.lock().remove(video_id); }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duracao() {
        assert_eq!(parse_duration("3:45"), Some(225_000));
        assert_eq!(parse_duration("1:02:03"), Some(3_723_000));
        assert_eq!(parse_duration("Album"), None);
    }
    #[test]
    fn expiracao_pela_url() {
        let e = expiry_ms("https://x/y?expire=4102444800&a=b", 1_000, None);
        assert_eq!(e, 1_000 + DEFAULT_STREAM_CACHE_MS); // limitado a 5 min
    }
}
