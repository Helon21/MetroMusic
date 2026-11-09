//! Provedores de música e a escolha de qual fornece o áudio de cada faixa.

pub mod auth;
pub mod deezer;
pub mod matcher;
pub mod soundcloud;
pub mod youtube;
pub mod ytmusic;

#[cfg(test)]
mod net_tests;

use crate::model::{now_ms, Res, StreamInfo, TrackInfo};
use futures_util::future::join_all;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::Duration;

const MATCH_SEARCH_TIMEOUT: Duration = Duration::from_secs(8);
const MATCH_CACHE_TTL_MS: u64 = 90_000;
const PER_PROVIDER_LIMIT: usize = 6;

/// Busca na fonte escolhida pelo usuário.
pub async fn search(provider: &str, query: &str, limit: usize) -> Res<Vec<TrackInfo>> {
    match provider {
        "youtube" => youtube::search(query, limit).await,
        "soundcloud" => soundcloud::search(query, limit).await,
        "deezer" => deezer::search(query, limit).await,
        other => Err(format!("provedor sem busca online: {other}")),
    }
}

async fn search_playable(provider: &str, query: &str) -> Vec<TrackInfo> {
    match tokio::time::timeout(MATCH_SEARCH_TIMEOUT, search(provider, query, PER_PROVIDER_LIMIT)).await {
        Ok(Ok(v)) => v,
        _ => vec![],
    }
}

static MATCHES: Lazy<Mutex<HashMap<String, (u64, Option<TrackInfo>)>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Procura a mesma música em `order` (provedores que tocam por inteiro) e devolve a melhor correspondência.
/// Busca em paralelo, com limite de tempo, e escolhe pela confiança do matcher e, no empate, pela ordem.
pub async fn find_match(wanted: &TrackInfo, order: &[String]) -> Option<TrackInfo> {
    let cache_key = format!("{}|{}", wanted.key(), order.join(","));
    if let Some((at, found)) = MATCHES.lock().get(&cache_key) {
        if now_ms() - at < MATCH_CACHE_TTL_MS { return found.clone(); }
    }
    let term = format!("{} {}", wanted.title, wanted.artists.join(" ")).trim().to_string();
    let batches = join_all(order.iter().map(|p| search_playable(p, &term))).await;
    let mut best: Option<(TrackInfo, i32, usize)> = None;
    for (rank, candidates) in batches.iter().enumerate() {
        if let Some((t, score)) = matcher::best(wanted, candidates) {
            let better = best.as_ref().map_or(true, |(_, s, r)| score > *s || (score == *s && rank < *r));
            if better { best = Some((t, score, rank)); }
        }
    }
    let found = best.map(|(t, _, _)| t);
    MATCHES.lock().insert(cache_key, (now_ms(), found.clone()));
    found
}

/// Descobre o stream de áudio de uma faixa.
///
/// - YouTube e SoundCloud tocam direto do próprio serviço.
/// - Deezer só tem o trecho de 30 s na API pública; a faixa inteira vem da correspondência em
///   `order`. Se nada corresponder, toca o trecho.
pub async fn resolve(track: &TrackInfo, order: &[String]) -> Res<StreamInfo> {
    match track.provider.as_str() {
        "youtube" => youtube::resolve(&track.id, track.duration_ms).await,
        "soundcloud" => soundcloud::resolve(track).await,
        "deezer" => {
            if let Some(m) = find_match(track, order).await {
                match resolve_direct(&m).await {
                    Ok(s) => return Ok(s),
                    Err(e) => eprintln!("[resolve] correspondência {} falhou: {e}", m.key()),
                }
            }
            preview_stream(track)
        }
        other => Err(format!("provedor desconhecido: {other}")),
    }
}

async fn resolve_direct(t: &TrackInfo) -> Res<StreamInfo> {
    match t.provider.as_str() {
        "youtube" => youtube::resolve(&t.id, t.duration_ms).await,
        "soundcloud" => soundcloud::resolve(t).await,
        other => Err(format!("provedor não toca por inteiro: {other}")),
    }
}

fn preview_stream(track: &TrackInfo) -> Res<StreamInfo> {
    let url = track.preview_url.clone().ok_or("Deezer: sem trecho disponível e sem correspondência em outro provedor")?;
    Ok(StreamInfo {
        url,
        headers: vec![("User-Agent".into(), crate::http::BROWSER_UA.into())],
        mime: "audio/mpeg".into(), codec: "mp3".into(), bitrate: 128_000, content_length: None, ext: "mp3".into(),
        expires_at_ms: now_ms() + 20 * 60 * 1000, source: "deezer-preview".into(), source_id: track.id.clone(), segments: vec![],
    })
}

/// Esquece URLs guardadas (usado quando uma URL expira antes do previsto).
pub fn invalidate(source: &str, id: &str) {
    match source {
        "youtube" => youtube::invalidate(id),
        "soundcloud" => soundcloud::invalidate(id),
        _ => {}
    }
}
