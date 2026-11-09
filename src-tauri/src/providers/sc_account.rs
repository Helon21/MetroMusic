//! Conta do SoundCloud: sessão (`oauth_token` do site), perfil, curtidas, playlists e histórico.

use super::soundcloud::{api, api_write, to_track};
use super::ytmusic::{CollectionRef, Item, Page};
use crate::model::{Res, TrackInfo};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

const API: &str = "https://api-v2.soundcloud.com";

static TOKEN: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));
static FILE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

pub fn token() -> Option<String> { TOKEN.read().clone() }
pub fn is_logged_in() -> bool { TOKEN.read().is_some() }

pub fn init(path: PathBuf) {
    *FILE.write() = Some(path.clone());
    if let Ok(t) = std::fs::read_to_string(&path) { let t = t.trim().to_string(); if !t.is_empty() { *TOKEN.write() = Some(t); } }
}

/// Aceita o valor puro do cookie `oauth_token` ou o cabeçalho completo ("OAuth 2-…").
pub fn clean_token(raw: &str) -> String {
    let t = raw.trim().trim_start_matches("Authorization:").trim();
    let t = t.strip_prefix("OAuth ").or_else(|| t.strip_prefix("oauth ")).unwrap_or(t);
    let t = t.strip_prefix("oauth_token=").unwrap_or(t);
    t.split(';').next().unwrap_or("").trim().to_string()
}

pub fn set_token(raw: &str) -> Res<()> {
    let t = clean_token(raw);
    if t.len() < 10 { return Err("o token do SoundCloud parece inválido (copie o valor do cookie oauth_token)".into()); }
    if let Some(path) = FILE.read().clone() {
        if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
        std::fs::write(&path, &t).map_err(|e| format!("não foi possível guardar a sessão: {e}"))?;
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)); }
    }
    *TOKEN.write() = Some(t);
    Ok(())
}

pub fn clear() {
    *TOKEN.write() = None;
    if let Some(path) = FILE.read().clone() { let _ = std::fs::remove_file(path); }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Me { pub id: u64, pub name: String, pub handle: Option<String>, pub avatar: Option<String> }

pub async fn me() -> Res<Me> {
    if !is_logged_in() { return Err("entre na sua conta do SoundCloud primeiro".into()); }
    let v = api(&format!("{API}/me"), &[]).await?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(str::to_string);
    Ok(Me {
        id: v.get("id").and_then(|i| i.as_u64()).ok_or("a sessão não é válida (o SoundCloud não reconheceu a conta); entre de novo")?,
        name: s("full_name").or_else(|| s("username")).ok_or("a conta não tem nome")?,
        handle: s("permalink"), avatar: s("avatar_url").map(|u| u.replace("-large.", "-t500x500.")),
    })
}

/// Percorre `next_href` até o fim (ou até `max` páginas).
async fn pages(first: &str, params: &[(&str, String)], max: usize) -> Res<Vec<Value>> {
    let mut out = vec![];
    let mut url = first.to_string();
    let mut p: Vec<(&str, String)> = params.to_vec();
    for _ in 0..max {
        let v = api(&url, &p).await?;
        if let Some(c) = v.get("collection").and_then(|c| c.as_array()) { out.extend(c.iter().cloned()); }
        match v.get("next_href").and_then(|n| n.as_str()) { Some(n) if !n.is_empty() => { url = n.to_string(); p = vec![]; } _ => break }
    }
    Ok(out)
}

fn playlist_ref(p: &Value) -> Option<Item> {
    let id = p.get("id").and_then(|i| i.as_u64())?;
    let title = p.get("title").and_then(|t| t.as_str())?.to_string();
    let n = p.get("track_count").and_then(|c| c.as_u64()).unwrap_or(0);
    let by = p.pointer("/user/username").and_then(|u| u.as_str()).unwrap_or("");
    let art = p.get("artwork_url").and_then(|a| a.as_str()).or_else(|| p.pointer("/user/avatar_url").and_then(|a| a.as_str())).map(|u| u.replace("-large.", "-t500x500."));
    Some(Item { track: None, collection: Some(CollectionRef { kind: "playlist".into(), id: format!("sc:{id}"), title, subtitle: format!("{by} · {n} faixas"), artwork: art }) })
}

/// Biblioteca da conta: "songs" (curtidas), "playlists" (suas e curtidas) ou "history".
pub async fn library(kind: &str) -> Res<Page> {
    let me = me().await?;
    let mut page = Page { kind: kind.into(), id: kind.into(), ..Default::default() };
    match kind {
        "songs" => {
            let rows = pages(&format!("{API}/users/{}/track_likes", me.id), &[("limit", "200".into())], 40).await?;
            page.tracks = rows.iter().filter_map(|r| r.get("track")).filter_map(to_track).collect();
        }
        "history" => {
            let rows = pages(&format!("{API}/me/play-history/tracks"), &[("limit", "50".into())], 10).await?;
            page.tracks = rows.iter().filter_map(|r| r.get("track")).filter_map(to_track).collect();
        }
        "playlists" => {
            let own = pages(&format!("{API}/users/{}/playlists_without_albums", me.id), &[("limit", "50".into())], 10).await.unwrap_or_default();
            let liked = pages(&format!("{API}/users/{}/playlist_likes", me.id), &[("limit", "50".into())], 10).await.unwrap_or_default();
            page.items = own.iter().filter_map(playlist_ref).chain(liked.iter().filter_map(|r| r.get("playlist")).filter_map(playlist_ref)).collect();
        }
        _ => return Err(format!("biblioteca do SoundCloud desconhecida: {kind}")),
    }
    Ok(page)
}

/// Faixas de uma playlist do SoundCloud (`sc:<id>`). A API devolve só o id das faixas fora do começo: busca o resto em lotes.
pub async fn playlist(id: &str) -> Res<Page> {
    let id = id.trim_start_matches("sc:");
    let v = api(&format!("{API}/playlists/{id}"), &[("representation", "full".into())]).await?;
    let list = v.get("tracks").and_then(|t| t.as_array()).cloned().unwrap_or_default();
    // (id, faixa): as completas já vêm na resposta; as outras são buscadas em lotes e voltam à posição certa pelo id
    let mut slots: Vec<(u64, Option<TrackInfo>)> = list.iter().filter_map(|t| {
        let id = t.get("id").and_then(|i| i.as_u64())?;
        Some((id, if t.get("title").is_some() { to_track(t) } else { None }))
    }).collect();
    let missing: Vec<u64> = list.iter().filter(|t| t.get("title").is_none()).filter_map(|t| t.get("id").and_then(|i| i.as_u64())).collect();
    for chunk in missing.chunks(30) {
        let ids = chunk.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let got = api(&format!("{API}/tracks"), &[("ids", ids)]).await.unwrap_or(Value::Null);
        for f in got.as_array().cloned().unwrap_or_default() {
            let Some(fid) = f.get("id").and_then(|i| i.as_u64()) else { continue };
            if let Some(slot) = slots.iter_mut().find(|(i, t)| *i == fid && t.is_none()) { slot.1 = to_track(&f); }
        }
    }
    let tracks: Vec<TrackInfo> = slots.into_iter().filter_map(|(_, t)| t).collect();
    let art = v.get("artwork_url").and_then(|a| a.as_str()).map(|u| u.replace("-large.", "-t500x500."));
    Ok(Page {
        kind: "playlist".into(), id: format!("sc:{id}"), title: v.get("title").and_then(|t| t.as_str()).unwrap_or("Playlist").into(),
        subtitle: v.pointer("/user/username").and_then(|u| u.as_str()).unwrap_or("").into(), artwork: art, tracks, ..Default::default()
    })
}

pub async fn rate(track_id: &str, like: bool) -> Res<()> {
    let me = me().await?;
    let url = format!("{API}/users/{}/track_likes/{track_id}", me.id);
    api_write(if like { reqwest::Method::PUT } else { reqwest::Method::DELETE }, &url).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limpa_token() {
        assert_eq!(clean_token("OAuth 2-123456-789-abcdef"), "2-123456-789-abcdef");
        assert_eq!(clean_token("Authorization: OAuth 2-1-2-3"), "2-1-2-3");
        assert_eq!(clean_token("oauth_token=2-99-88-77; other=1"), "2-99-88-77");
        assert_eq!(clean_token("  2-5-5-5  "), "2-5-5-5");
    }
}
