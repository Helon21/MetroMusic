//! Deezer pela API pública: busca, metadados e o trecho de 30 s.
//!
//! O áudio completo do Deezer é protegido (criptografado) e não é obtido aqui. Para tocar uma
//! faixa do Deezer por inteiro, o app procura a mesma música nos outros provedores
//! (ver `providers::resolve`), como faz o fallback do MetroFuse; sem correspondência, toca o trecho.

use crate::http::{err, CLIENT};
use crate::model::{Res, TrackInfo};
use serde_json::Value;

const API: &str = "https://api.deezer.com";

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(str::to_string)
}

fn to_track(v: &Value) -> Option<TrackInfo> {
    let id = v.get("id").and_then(|x| x.as_u64()).map(|x| x.to_string())?;
    let title = s(v, "title")?;
    let artist = v.get("artist").and_then(|a| s(a, "name")).unwrap_or_else(|| "Artista desconhecido".into());
    let album = v.get("album");
    Some(TrackInfo {
        provider: "deezer".into(),
        id,
        title,
        artists: vec![artist],
        album: album.and_then(|a| s(a, "title")),
        duration_ms: v.get("duration").and_then(|d| d.as_u64()).map(|d| d * 1000),
        isrc: s(v, "isrc"),
        artwork_url: album.and_then(|a| s(a, "cover_xl").or_else(|| s(a, "cover_big")).or_else(|| s(a, "cover_medium"))),
        explicit: v.get("explicit_lyrics").and_then(|x| x.as_bool()).unwrap_or(false),
        url: s(v, "link"),
        preview_url: s(v, "preview"),
        ..Default::default()
    })
}

pub async fn search(query: &str, limit: usize) -> Res<Vec<TrackInfo>> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let body: Value = CLIENT
        .get(format!("{API}/search/track"))
        .query(&[("q", query), ("limit", &limit.clamp(1, 50).to_string())])
        .send().await.map_err(err)?
        .error_for_status().map_err(err)?
        .json().await.map_err(err)?;
    if let Some(e) = body.get("error") {
        return Err(format!("Deezer: {}", s(e, "message").unwrap_or_default()));
    }
    Ok(body.get("data").and_then(|d| d.as_array()).map(|a| a.iter().filter_map(to_track).collect()).unwrap_or_default())
}

/// Dados completos da faixa (inclui o ISRC, que a busca não devolve).
pub async fn track(id: &str) -> Res<TrackInfo> {
    let v: Value = CLIENT.get(format!("{API}/track/{id}")).send().await.map_err(err)?.error_for_status().map_err(err)?.json().await.map_err(err)?;
    to_track(&v).ok_or_else(|| "Deezer: faixa não encontrada".to_string())
}
