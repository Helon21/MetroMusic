//! JioSaavn pela API web aberta (sem login). Porte de `JioSaavnAudioProvider` (MetroFuse).
//! O áudio vem de `song.generateAuthToken`, que troca o link cifrado da faixa por uma URL assinada
//! na taxa pedida (320, 160, 96 ou 48 kbps; a CDN devolve a mais próxima que a faixa tem).

use crate::http::{err, BROWSER_UA, CLIENT};
use crate::model::{now_ms, Res, StreamInfo, TrackInfo};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;

const API: &str = "https://www.jiosaavn.com/api.php";
const STREAM_CACHE_MS: u64 = 10 * 60 * 1000;

static STREAMS: Lazy<Mutex<HashMap<String, StreamInfo>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Chamada à API com os parâmetros fixos do site (`api_version=4`, JSON).
async fn call(method: &str, params: &[(&str, String)]) -> Res<Value> {
    let mut q: Vec<(&str, String)> = vec![("__call", method.into()), ("_format", "json".into()), ("_marker", "0".into()), ("api_version", "4".into()), ("ctx", "web6dot0".into())];
    q.extend(params.iter().cloned());
    let resp = CLIENT.get(API).query(&q).header("User-Agent", BROWSER_UA).header("Accept", "application/json").send().await.map_err(err)?;
    if !resp.status().is_success() { return Err(format!("JioSaavn HTTP {}", resp.status())); }
    resp.json().await.map_err(err)
}

/// A API devolve textos com entidades HTML (`&amp;`, `&quot;`, `&#039;`).
pub(crate) fn unescape(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&#039;", "'").replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

fn text(v: &Value, k: &str) -> Option<String> { v.get(k).and_then(|x| x.as_str()).map(unescape).filter(|s| !s.is_empty()) }

/// Capa em 500×500 (a API entrega 150×150).
pub(crate) fn big_image(url: &str) -> String { url.replace("150x150", "500x500").replace("50x50", "500x500") }

pub(crate) fn to_track(v: &Value) -> Option<TrackInfo> {
    if v.get("type").and_then(|t| t.as_str()).map_or(false, |t| t != "song") { return None; }
    let id = v.get("id")?.as_str()?.to_string();
    let title = text(v, "title")?;
    let more = v.get("more_info").cloned().unwrap_or(Value::Null);
    let mut artists: Vec<String> = more.pointer("/artistMap/primary_artists").and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|x| text(x, "name")).collect()).unwrap_or_default();
    if artists.is_empty() { artists = text(v, "subtitle").map(|s| vec![s]).unwrap_or_default(); }
    Some(TrackInfo {
        provider: "jiosaavn".into(), id, title, artists,
        album: text(&more, "album"),
        duration_ms: more.get("duration").or_else(|| v.get("duration")).and_then(|d| d.as_str().and_then(|s| s.parse::<u64>().ok()).or_else(|| d.as_u64())).map(|s| s * 1000),
        artwork_url: text(v, "image").map(|u| big_image(&u)),
        explicit: v.get("explicit_content").and_then(|e| e.as_str()) == Some("1"),
        url: text(v, "perma_url"),
        ..Default::default()
    })
}

fn tracks_of(list: &Value) -> Vec<TrackInfo> {
    list.as_array().map(|a| a.iter().filter_map(to_track).collect()).unwrap_or_default()
}

pub async fn search(query: &str, limit: usize) -> Res<Vec<TrackInfo>> {
    let v = call("search.getResults", &[("q", query.to_string()), ("p", "1".into()), ("n", limit.clamp(1, 50).to_string())]).await?;
    Ok(tracks_of(v.get("results").unwrap_or(&Value::Null)))
}

/// Taxa pedida (`320`, `160`, `96`, `48`); valor desconhecido vira 320.
pub(crate) fn clean_quality(q: &str) -> &'static str { match q { "160" => "160", "96" => "96", "48" => "48", _ => "320" } }

/// Taxa real a partir da URL (`..._320.mp4`).
pub(crate) fn bitrate_of(url: &str) -> u32 {
    let path = url.split('?').next().unwrap_or(url);
    path.rsplit('_').next().and_then(|s| s.split('.').next()).and_then(|n| n.parse::<u32>().ok()).map(|k| k * 1000).unwrap_or(96_000)
}

pub async fn resolve(track: &TrackInfo) -> Res<StreamInfo> {
    let quality = super::prefs::jio_quality();
    let key = format!("{}|{quality}", track.id);
    if let Some(s) = STREAMS.lock().get(&key).filter(|s| s.expires_at_ms > now_ms() + 20_000).cloned() { return Ok(s); }
    let details = call("song.getDetails", &[("pids", track.id.clone())]).await?;
    let song = details.get("songs").and_then(|s| s.as_array()).and_then(|a| a.first()).cloned()
        .or_else(|| details.get(&track.id).cloned()).ok_or("JioSaavn: faixa não encontrada")?;
    let enc = song.pointer("/more_info/encrypted_media_url").and_then(|e| e.as_str()).filter(|s| !s.is_empty())
        .ok_or("JioSaavn: faixa sem áudio disponível")?;
    let auth = call("song.generateAuthToken", &[("url", enc.to_string()), ("bitrate", quality.clone())]).await?;
    let url = auth.get("auth_url").and_then(|u| u.as_str()).filter(|s| !s.is_empty()).ok_or("JioSaavn: resposta sem URL de áudio")?.to_string();
    let info = StreamInfo {
        bitrate: bitrate_of(&url),
        url,
        headers: vec![("User-Agent".into(), BROWSER_UA.into()), ("Accept-Encoding".into(), "identity".into())],
        mime: "audio/mp4".into(), codec: "aac".into(), content_length: None, ext: "m4a".into(),
        expires_at_ms: now_ms() + STREAM_CACHE_MS, source: "jiosaavn".into(), source_id: track.id.clone(), segments: vec![], loudness_lufs: None,
    };
    STREAMS.lock().insert(key, info.clone());
    Ok(info)
}

pub fn invalidate(id: &str) { STREAMS.lock().retain(|k, _| !k.starts_with(&format!("{id}|"))); }
pub fn clear_streams() { STREAMS.lock().clear(); }

/// Início no idioma escolhido: faixas em alta e as paradas.
pub async fn home() -> Res<Vec<super::ytmusic::Section>> {
    let lang = super::prefs::jio_language();
    let v = call("content.getBrowseModules", &[("language", lang.clone())]).await?;
    let mut out = vec![];
    let mut push = |title: &str, tracks: Vec<TrackInfo>| {
        if tracks.is_empty() { return; }
        out.push(super::ytmusic::Section { title: title.into(), label: Some("JioSaavn".into()), layout: "list".into(), items: tracks.into_iter().map(|t| super::ytmusic::Item { track: Some(t), collection: None }).collect(), more: None });
    };
    push("Em alta agora", tracks_of(v.get("new_trending").unwrap_or(&Value::Null)));
    // as paradas são playlists: abre as duas primeiras para listar as faixas
    let charts: Vec<String> = v.get("charts").and_then(|c| c.as_array()).map(|a| a.iter().filter_map(|x| x.get("id").and_then(|i| i.as_str()).map(String::from)).take(2).collect()).unwrap_or_default();
    for id in charts {
        if let Ok(p) = call("playlist.getDetails", &[("listid", id), ("n", "30".into()), ("p", "1".into())]).await {
            let title = text(&p, "title").unwrap_or_else(|| "Parada".into());
            push(&title, tracks_of(p.get("list").unwrap_or(&Value::Null)));
        }
    }
    if out.is_empty() { Err(format!("o JioSaavn não devolveu conteúdo em {lang}")) } else { Ok(out) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn faixa_da_busca() {
        let v = json!({"id": "1ZDl", "title": "Rock &amp; Roll &quot;Live&quot;", "type": "song", "image": "https://c.saavncdn.com/209/x-150x150.jpg",
            "explicit_content": "1", "perma_url": "https://www.jiosaavn.com/song/x/abc",
            "more_info": {"album": "A &amp; B", "duration": "202", "artistMap": {"primary_artists": [{"name": "Ana"}, {"name": "Beto"}]}}});
        let t = to_track(&v).unwrap();
        assert_eq!((t.title.as_str(), t.album.as_deref(), t.duration_ms), ("Rock & Roll \"Live\"", Some("A & B"), Some(202_000)));
        assert_eq!(t.artists, vec!["Ana", "Beto"]);
        assert!(t.explicit && t.artwork_url.unwrap().contains("500x500"));
        assert!(to_track(&json!({"id": "9", "title": "Álbum", "type": "album"})).is_none());
    }

    #[test]
    fn taxa_vem_da_url_e_qualidade_invalida_vira_320() {
        assert_eq!(bitrate_of("https://web.saavncdn.com/209/abc_320.mp4?Expires=1&Signature=x_y"), 320_000);
        assert_eq!(bitrate_of("https://x/abc_96.mp4"), 96_000);
        assert_eq!(bitrate_of("https://x/semtaxa"), 96_000);
        assert_eq!((clean_quality("160"), clean_quality("lixo")), ("160", "320"));
    }
}
