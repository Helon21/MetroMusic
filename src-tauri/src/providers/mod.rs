//! Provedores de música e a escolha de qual fornece o áudio de cada faixa.

pub mod health;
pub mod prefs;
pub mod auth;
pub mod deezer;
pub mod jiosaavn;
pub mod matcher;
pub mod sc_account;
pub mod spotify;
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
        "spotify" => spotify::search(query, limit).await,
        "jiosaavn" => jiosaavn::search(query, limit).await,
        other => Err(format!("provedor sem busca online: {other}")),
    }
}

async fn search_playable(provider: &str, query: &str) -> Vec<TrackInfo> {
    match tokio::time::timeout(MATCH_SEARCH_TIMEOUT, search(provider, query, PER_PROVIDER_LIMIT)).await {
        Ok(Ok(v)) => v,
        _ => vec![],
    }
}

/// Uma opção de fonte de áudio para a mesma música (o que o modal "Escolher fonte de áudio" lista).
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub track: TrackInfo,
    /// Confiança do matcher (200 a 400); a própria faixa, quando toca por inteiro, vale 400.
    pub score: i32,
    /// Tempo que a busca naquele provedor levou.
    pub ms: u64,
}

const PLAYS_WHOLE: [&str; 2] = ["youtube", "soundcloud"];

/// Procura a mesma música em cada provedor de `order` (em paralelo) e devolve só os resultados válidos,
/// agrupados na ordem dos provedores e, dentro de cada um, do mais para o menos confiável.
pub async fn candidates(wanted: &TrackInfo, order: &[String]) -> Vec<Candidate> {
    let term = format!("{} {}", wanted.title, wanted.artists.join(" ")).trim().to_string();
    let mut providers: Vec<String> = order.iter().filter(|p| PLAYS_WHOLE.contains(&p.as_str())).cloned().collect();
    if PLAYS_WHOLE.contains(&wanted.provider.as_str()) && !providers.contains(&wanted.provider) { providers.push(wanted.provider.clone()); }
    let batches = join_all(providers.iter().map(|p| async {
        let t0 = std::time::Instant::now();
        let found = search_playable(p, &term).await;
        (found, t0.elapsed().as_millis() as u64)
    })).await;
    let mut out: Vec<Candidate> = vec![];
    for (provider, (found, ms)) in providers.iter().zip(batches) {
        let mut valid: Vec<Candidate> = matcher::ranked(wanted, &found).into_iter().take(4).map(|(track, score)| Candidate { track, score, ms }).collect();
        // a própria faixa sempre aparece na sua fonte, mesmo que a busca não a devolva
        if *provider == wanted.provider && !valid.iter().any(|c| c.track.id == wanted.id) { valid.insert(0, Candidate { track: wanted.clone(), score: 400, ms }); }
        out.extend(valid);
    }
    out
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
    let (limit_on, diag) = flags();
    let t0 = std::time::Instant::now();
    let r = limited(limit_on, ATTEMPT_LIMIT, &track.provider, resolve_inner(track, order)).await;
    if diag {
        match &r {
            Ok(s) => eprintln!("[diagnóstico] {} · {} → {} {} kbps via {} em {} ms", track.key(), track.title, s.codec, s.bitrate / 1000, s.source, t0.elapsed().as_millis()),
            Err(e) => eprintln!("[diagnóstico] {} · {} → falhou em {} ms: {e}", track.key(), track.title, t0.elapsed().as_millis()),
        }
    }
    r
}

/// Tempo máximo de uma tentativa quando "Limitar tentativas por provedor" está ligado.
const ATTEMPT_LIMIT: Duration = Duration::from_secs(20);

/// `expProviderTimeout` (padrão ligado) e `expDiagnostics` (padrão desligado), lidos das configurações gravadas.
fn flags() -> (bool, bool) {
    let v = crate::settings::current().values;
    let get = |k: &str, d: bool| v.get(k).and_then(|x| x.as_bool()).unwrap_or(d);
    (get("expProviderTimeout", true), get("expDiagnostics", false))
}

/// Aplica o limite de tempo a uma tentativa (ou deixa correr livre se `on` for falso).
async fn limited<T>(on: bool, limit: Duration, who: &str, fut: impl std::future::Future<Output = Res<T>>) -> Res<T> {
    if !on { return fut.await; }
    match tokio::time::timeout(limit, fut).await {
        Ok(r) => r,
        Err(_) => Err(format!("{who}: sem resposta em {} s; passando para o próximo", limit.as_secs())),
    }
}

async fn resolve_inner(track: &TrackInfo, order: &[String]) -> Res<StreamInfo> {
    match track.provider.as_str() {
        "youtube" => youtube::resolve(&track.id, track.duration_ms).await,
        "soundcloud" => soundcloud::resolve(track).await,
        "jiosaavn" => jiosaavn::resolve(track).await,
        "local" => crate::local::resolve(track),
        // Deezer e Spotify não entregam o áudio inteiro (DRM): toca-se a mesma música achada em outro provedor.
        "deezer" | "spotify" => {
            if let Some(m) = find_match(track, order).await {
                let (limit_on, _) = flags();
                match limited(limit_on, ATTEMPT_LIMIT, &m.provider, resolve_direct(&m)).await {
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
        "jiosaavn" => jiosaavn::resolve(t).await,
        "local" => crate::local::resolve(t),
        other => Err(format!("provedor não toca por inteiro: {other}")),
    }
}

fn preview_stream(track: &TrackInfo) -> Res<StreamInfo> {
    let url = track.preview_url.clone().ok_or_else(|| format!("{}: sem correspondência em outro provedor para tocar esta faixa", track.provider))?;
    Ok(StreamInfo {
        url,
        headers: vec![("User-Agent".into(), crate::http::BROWSER_UA.into())],
        mime: "audio/mpeg".into(), codec: "mp3".into(), bitrate: 128_000, content_length: None, ext: "mp3".into(),
        expires_at_ms: now_ms() + 20 * 60 * 1000, source: "deezer-preview".into(), source_id: track.id.clone(), segments: vec![], loudness_lufs: None,
    })
}

/// Esquece URLs guardadas (usado quando uma URL expira antes do previsto).
pub fn invalidate(source: &str, id: &str) {
    match source {
        "youtube" => youtube::invalidate(id),
        "soundcloud" => soundcloud::invalidate(id),
        "jiosaavn" => jiosaavn::invalidate(id),
        _ => {}
    }
}

/// Início das fontes que não têm uma tela própria: paradas reais do SoundCloud e do Deezer.
pub async fn other_home(provider: &str) -> Res<Vec<ytmusic::Section>> {
    fn list(title: &str, label: &str, tracks: Vec<TrackInfo>) -> Option<ytmusic::Section> {
        if tracks.is_empty() { return None; }
        Some(ytmusic::Section { title: title.into(), label: Some(label.into()), layout: "list".into(), items: tracks.into_iter().map(|t| ytmusic::Item { track: Some(t), collection: None }).collect(), more: None })
    }
    match provider {
        "spotify" => spotify::home().await,
        "jiosaavn" => jiosaavn::home().await,
        "soundcloud" => {
            let (trending, top) = tokio::join!(soundcloud::chart("trending", 24), soundcloud::chart("top", 24));
            let out: Vec<_> = [list("Em alta", "SoundCloud", trending.unwrap_or_default()), list("Mais tocadas", "SoundCloud", top.unwrap_or_default())].into_iter().flatten().collect();
            if out.is_empty() { Err("o SoundCloud não devolveu as paradas".into()) } else { Ok(out) }
        }
        "deezer" => {
            let out: Vec<_> = [list("Mais tocadas agora", "Deezer", deezer::chart(48).await?)].into_iter().flatten().collect();
            if out.is_empty() { Err("o Deezer não devolveu a parada".into()) } else { Ok(out) }
        }
        other => Err(format!("a fonte {other} ainda não tem backend")),
    }
}

/// Rótulos que o YouTube Music usa para o tipo do item ("Música", "Vídeo"…), nos idiomas suportados.
/// Não são artistas; ficam de fora ao procurar o nome do artista.
pub fn is_type_label(t: &str) -> bool {
    matches!(t, "Song" | "Video" | "Música" | "Vídeo" | "Canción" | "Vidéo" | "Chanson" | "Titel" | "曲" | "動画" | "Canzone")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn limite_de_tempo_so_vale_quando_ligado() {
        let lento = || async { tokio::time::sleep(Duration::from_millis(80)).await; Ok::<_, String>(7) };
        let e = limited(true, Duration::from_millis(10), "youtube", lento()).await.unwrap_err();
        assert!(e.starts_with("youtube: sem resposta"), "{e}");
        assert_eq!(limited(false, Duration::from_millis(10), "youtube", lento()).await.unwrap(), 7);
        assert_eq!(limited(true, Duration::from_secs(5), "youtube", lento()).await.unwrap(), 7);
    }
}
