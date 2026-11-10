//! Spotify via WebView login (cookie `sp_dc`) + Device Authorization Flow.
//!
//! O usuário entra no player web (`open.spotify.com`) num WebView anônimo; capturamos o cookie
//! `sp_dc` e usamos o **Device Authorization Flow** do Spotify com o **Client ID oficial do app
//! desktop do Spotify** (hardcoded no MetroFuse) para obter access tokens. Não precisa criar app
//! no developer.spotify.com.
//!
//! O áudio **não** vem do Spotify (DRM): as faixas tocam por correspondência no YouTube Music /
//! SoundCloud / Deezer, igual ao Deezer.

use super::ytmusic::{CollectionRef, Item, Page, Section};
use crate::http::{err, CLIENT};
use crate::model::{now_ms, Res, TrackInfo};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

const API: &str = "https://api.spotify.com/v1";
const ACCOUNTS: &str = "https://accounts.spotify.com";

/// Client ID do app desktop oficial do Spotify (extraído do MetroFuse).
const DEVICE_CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
const DEVICE_AUTH_URL: &str = "https://accounts.spotify.com/oauth2/device/authorize";
const DEVICE_TOKEN_URL: &str = "https://accounts.spotify.com/api/token"; // endpoint correto (com sp_dc cookie)
const DEVICE_SCOPE: &str = "user-read-private user-read-email user-library-read user-library-modify playlist-read-private playlist-read-collaborative user-follow-read user-read-recently-played user-top-read streaming";

#[derive(Serialize, Deserialize, Clone, Default)]
struct State {
    sp_dc: String,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at_ms: u64,
}

static STATE: Lazy<RwLock<State>> = Lazy::new(|| RwLock::new(State::default()));
static FILE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub has_client_id: bool,
    pub logged_in: bool,
    pub redirect: &'static str,
}

pub fn status() -> Status {
    let s = STATE.read();
    Status { has_client_id: true, logged_in: s.refresh_token.is_some(), redirect: "https://open.spotify.com" }
}
pub fn is_logged_in() -> bool { STATE.read().refresh_token.is_some() }

pub fn init(path: PathBuf) {
    *FILE.write() = Some(path.clone());
    if let Ok(b) = std::fs::read(&path) { if let Ok(s) = serde_json::from_slice::<State>(&b) { *STATE.write() = s; } }
}

fn save() {
    let Some(path) = FILE.read().clone() else { return };
    if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
    if let Ok(bytes) = serde_json::to_vec(&*STATE.read()) {
        let _ = std::fs::write(&path, bytes);
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)); }
    }
}

pub fn logout() {
    { let mut s = STATE.write(); s.sp_dc.clear(); s.access_token = None; s.refresh_token = None; s.expires_at_ms = 0; }
    save();
}

// ───────── Login via WebView (frontend chama sp_login_start / sp_login_cancel)

/// Inicia o fluxo: frontend abre WebView em `https://accounts.spotify.com/en/login?continue=https%3A%2F%2Fopen.spotify.com%2F`
/// e monitora cookies de `open.spotify.com` / `accounts.spotify.com` / `www.spotify.com` / `spotify.com`.
/// Quando `sp_dc` aparece, frontend chama `sp_login_cookie(sp_dc)`.
pub async fn begin(_client_id: Option<String>) -> Res<()> {
    Ok(()) // só avisa o frontend para abrir o WebView
}

pub fn cancel() {}

/// Recebe o cookie `sp_dc` (e opcionalmente outros cookies do domínio) e troca por tokens via Device Flow.
pub async fn finish(sp_dc: &str) -> Res<crate::providers::spotify::Me> {
    if sp_dc.trim().is_empty() { return Err("cookie sp_dc vazio".into()); }
    let sp_dc = sp_dc.trim().to_string();

    // 1) Device Authorization Request
    let auth = device_authorize().await?;
    // 2) Poll do token usando o cookie sp_dc (endpoint /api/token com cookie)
    let tokens = poll_device_token(&auth.device_code, &sp_dc).await?;
    store_tokens(&sp_dc, &tokens)?;

    match me().await {
        Ok(m) => Ok(m),
        Err(e) => { logout(); Err(e) }
    }
}

async fn device_authorize() -> Res<DeviceAuth> {
    let resp = CLIENT.post(DEVICE_AUTH_URL)
        .form(&[("client_id", DEVICE_CLIENT_ID), ("scope", DEVICE_SCOPE)])
        .send().await.map_err(err)?;
    let status = resp.status();
    let text = resp.text().await.map_err(err)?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("device auth: JSON inválido: {e} | body: {}", text.chars().take(500).collect::<String>()))?;
    if !status.is_success() { return Err(format!("Spotify device auth: {}", v.get("error_description").or_else(|| v.get("error")).and_then(|e| e.as_str()).unwrap_or("falhou"))); }
    Ok(DeviceAuth {
        device_code: v.get("device_code").and_then(|x| x.as_str()).ok_or("sem device_code")?.to_string(),
        user_code: v.get("user_code").and_then(|x| x.as_str()).ok_or("sem user_code")?.to_string(),
        verification_uri: v.get("verification_uri").and_then(|x| x.as_str()).ok_or("sem verification_uri")?.to_string(),
        verification_uri_complete: v.get("verification_uri_complete").and_then(|x| x.as_str()).ok_or("sem verification_uri_complete")?.to_string(),
        expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(1800),
        interval: v.get("interval").and_then(|x| x.as_u64()).unwrap_or(5),
    })
}

async fn poll_device_token(device_code: &str, sp_dc: &str) -> Res<TokenResponse> {
    let start = std::time::Instant::now();
    let mut interval = 5u64;
    loop {
        let resp = CLIENT.post(DEVICE_TOKEN_URL)
            .header("Cookie", format!("sp_dc={sp_dc}"))
            .form(&[("grant_type", "urn:ietf:params:oauth:grant-type:device_code"), ("device_code", device_code), ("client_id", DEVICE_CLIENT_ID)])
            .send().await.map_err(err)?;
        let status = resp.status();
        let text = resp.text().await.map_err(err)?;
        let v: Value = serde_json::from_str(&text).map_err(|e| format!("device token: JSON inválido: {e} | body: {}", text.chars().take(500).collect::<String>()))?;
        if status.is_success() {
            return Ok(TokenResponse {
                access_token: v.get("access_token").and_then(|x| x.as_str()).ok_or("sem access_token")?.to_string(),
                refresh_token: v.get("refresh_token").and_then(|x| x.as_str()).map(str::to_string),
                expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(3600),
            });
        }
        let err_code = v.get("error").and_then(|x| x.as_str()).unwrap_or("");
        if err_code == "authorization_pending" || err_code == "slow_down" {
            if err_code == "slow_down" { interval *= 2; }
            if start.elapsed() > Duration::from_secs(300) { return Err("tempo esgotado aguardando autorização".into()); }
            tokio::time::sleep(Duration::from_secs(interval)).await;
            continue;
        }
        return Err(format!("Spotify device token: {}", v.get("error_description").or_else(|| v.get("error")).and_then(|e| e.as_str()).unwrap_or("falhou")));
    }
}

#[derive(Debug)]
struct DeviceAuth { device_code: String, user_code: String, verification_uri: String, verification_uri_complete: String, expires_in: u64, interval: u64 }
#[derive(Debug)]
struct TokenResponse { access_token: String, refresh_token: Option<String>, expires_in: u64 }

fn store_tokens(sp_dc: &str, tokens: &TokenResponse) -> Res<()> {
    let mut s = STATE.write();
    s.sp_dc = sp_dc.to_string();
    s.access_token = Some(tokens.access_token.clone());
    s.refresh_token = tokens.refresh_token.clone();
    s.expires_at_ms = now_ms() + tokens.expires_in * 1000 - 60_000;
    drop(s);
    save();
    Ok(())
}

async fn refresh() -> Res<()> {
    let (sp_dc, rt) = { let s = STATE.read(); (s.sp_dc.clone(), s.refresh_token.clone()) };
    let rt = rt.ok_or("entre na sua conta do Spotify primeiro")?;
    let resp = CLIENT.post(format!("{ACCOUNTS}/api/token"))
        .header("Cookie", format!("sp_dc={sp_dc}"))
        .form(&[("grant_type", "refresh_token"), ("refresh_token", &rt), ("client_id", DEVICE_CLIENT_ID)])
        .send().await.map_err(err)?;
    let status = resp.status();
    let text = resp.text().await.map_err(err)?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("refresh: JSON inválido: {e} | body: {}", text.chars().take(500).collect::<String>()))?;
    if !status.is_success() {
        if v.get("error").and_then(|x| x.as_str()) == Some("invalid_grant") { logout(); }
        return Err(format!("Spotify refresh: {}", v.get("error_description").or_else(|| v.get("error")).and_then(|e| e.as_str()).unwrap_or("falhou")));
    }
    store_tokens(&sp_dc, &TokenResponse {
        access_token: v.get("access_token").and_then(|x| x.as_str()).ok_or("sem access_token")?.to_string(),
        refresh_token: v.get("refresh_token").and_then(|x| x.as_str()).map(str::to_string),
        expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(3600),
    })
}

async fn token() -> Res<String> {
    let expired = { let s = STATE.read(); s.access_token.is_none() || s.expires_at_ms <= now_ms() };
    if expired { refresh().await?; }
    STATE.read().access_token.clone().ok_or_else(|| "entre na sua conta do Spotify primeiro".to_string())
}

async fn get_sp_dc() -> Res<String> {
    let sp_dc = STATE.read().sp_dc.clone();
    if sp_dc.is_empty() { return Err("não logado no Spotify (falta sp_dc)".into()); }
    Ok(sp_dc)
}

// ───────── API

async fn request(method: reqwest::Method, path: &str, query: &[(&str, String)]) -> Res<Value> {
    let url = if path.starts_with("http") { path.to_string() } else { format!("{API}{path}") };
    for attempt in 0..3 {
        let t = token().await?;
        let mut req = CLIENT.request(method.clone(), &url).query(query).bearer_auth(t);
        if method == reqwest::Method::PUT || method == reqwest::Method::POST || method == reqwest::Method::DELETE {
            req = req.header("Content-Length", "0");
        }
        let resp = req.send().await.map_err(err)?;
        let status = resp.status();
        let headers = resp.headers().clone();
        let text = resp.text().await.map_err(err)?;
        let v: Value = serde_json::from_str(&text).map_err(|e| format!("API {path}: JSON inválido: {e} | body: {}", text.chars().take(500).collect::<String>()))?;
        if status.as_u16() == 401 && attempt == 0 { refresh().await?; continue; }
        if status.as_u16() == 429 {
            let wait = headers.get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok()).unwrap_or(2).min(8);
            tokio::time::sleep(Duration::from_secs(wait)).await;
            continue;
        }
        if !status.is_success() {
            return Err(format!("Spotify HTTP {status}: {}", v.pointer("/error/message").and_then(|m| m.as_str()).unwrap_or("erro")));
        }
        return Ok(v);
    }
    Err("Spotify: muitas tentativas".into())
}
async fn get(path: &str, query: &[(&str, String)]) -> Res<Value> { request(reqwest::Method::GET, path, query).await }

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Me { pub id: String, pub name: String, pub handle: Option<String>, pub avatar: Option<String> }

pub async fn me() -> Res<Me> {
    let v = get("/me", &[]).await?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(str::to_string);
    let id = s("id").ok_or("a sessão não é válida (o Spotify não reconheceu a conta); entre de novo")?;
    Ok(Me { name: s("display_name").unwrap_or_else(|| id.clone()), id, handle: None, avatar: v.pointer("/images/0/url").and_then(|u| u.as_str()).map(str::to_string) })
}

fn s(v: &Value, k: &str) -> Option<String> { v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(str::to_string) }

fn to_track(t: &Value, album_fallback: Option<&Value>) -> Option<TrackInfo> {
    if t.get("type").and_then(|x| x.as_str()).map_or(false, |k| k != "track") { return None; }
    let id = s(t, "id")?;
    let album = t.get("album").filter(|a| a.is_object()).or(album_fallback);
    let artists: Vec<String> = t.get("artists").and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|x| s(x, "name")).collect()).unwrap_or_default();
    Some(TrackInfo {
        provider: "spotify".into(), id: id.clone(), title: s(t, "name")?, artists: if artists.is_empty() { vec!["Artista desconhecido".into()] } else { artists },
        album: album.and_then(|a| s(a, "name")),
        duration_ms: t.get("duration_ms").and_then(|d| d.as_u64()),
        isrc: t.pointer("/external_ids/isrc").and_then(|i| i.as_str()).map(str::to_string),
        artwork_url: album.and_then(|a| a.pointer("/images/0/url")).and_then(|u| u.as_str()).map(str::to_string),
        explicit: t.get("explicit").and_then(|e| e.as_bool()).unwrap_or(false),
        url: t.pointer("/external_urls/spotify").and_then(|u| u.as_str()).map(str::to_string),
        album_id: album.and_then(|a| s(a, "id")).map(|i| format!("sp:album:{i}")),
        artist_id: t.pointer("/artists/0/id").and_then(|i| i.as_str()).map(|i| format!("sp:artist:{i}")),
        ..Default::default()
    })
}

fn collection(kind: &str, v: &Value, subtitle: String) -> Option<Item> {
    let id = s(v, "id")?;
    Some(Item { track: None, collection: Some(CollectionRef { kind: kind.into(), id: format!("sp:{kind}:{id}"), title: s(v, "name")?, subtitle, artwork: v.pointer("/images/0/url").and_then(|u| u.as_str()).map(str::to_string) }) })
}

async fn paged(path: &str, query: &[(&str, String)], max: usize) -> Res<Vec<Value>> {
    let mut out = vec![];
    let mut v = get(path, query).await?;
    for _ in 0..max {
        if let Some(items) = v.get("items").and_then(|i| i.as_array()) { out.extend(items.iter().cloned()); }
        match v.get("next").and_then(|n| n.as_str()).map(str::to_string) { Some(n) => v = get(&n, &[]).await?, None => break }
    }
    Ok(out)
}

pub async fn search(query: &str, limit: usize) -> Res<Vec<TrackInfo>> {
    if query.trim().is_empty() || !is_logged_in() { return Ok(vec![]); }
    let v = get("/search", &[("q", query.into()), ("type", "track".into()), ("limit", limit.clamp(1, 50).to_string())]).await?;
    Ok(v.pointer("/tracks/items").and_then(|i| i.as_array()).map(|a| a.iter().filter_map(|t| to_track(t, None)).collect()).unwrap_or_default())
}

pub async fn library(kind: &str) -> Res<Page> {
    let mut page = Page { kind: kind.into(), id: kind.into(), ..Default::default() };
    match kind {
        "songs" => page.tracks = paged("/me/tracks", &[("limit", "50".into())], 60).await?.iter().filter_map(|i| i.get("track")).filter_map(|t| to_track(t, None)).collect(),
        "history" => {
            let v = get("/me/player/recently-played", &[("limit", "50".into())]).await?;
            let mut seen_run: Option<String> = None;
            for i in v.get("items").and_then(|i| i.as_array()).into_iter().flatten() {
                if let Some(t) = i.get("track").and_then(|t| to_track(t, None)) {
                    if seen_run.as_deref() == Some(&t.id) { continue; }
                    seen_run = Some(t.id.clone());
                    page.tracks.push(t);
                }
            }
        }
        "playlists" => page.items = paged("/me/playlists", &[("limit", "50".into())], 20).await?.iter().filter_map(|p| {
            let by = p.pointer("/owner/display_name").and_then(|o| o.as_str()).unwrap_or("");
            let n = p.pointer("/tracks/total").and_then(|n| n.as_u64()).unwrap_or(0);
            collection("playlist", p, format!("{by} · {n} faixas"))
        }).collect(),
        "albums" => page.items = paged("/me/albums", &[("limit", "50".into())], 20).await?.iter().filter_map(|a| a.get("album")).filter_map(|a| {
            let by = a.pointer("/artists/0/name").and_then(|o| o.as_str()).unwrap_or("");
            collection("album", a, format!("Álbum · {by}"))
        }).collect(),
        "artists" => {
            let mut after: Option<String> = None;
            for _ in 0..10 {
                let mut q = vec![("type", "artist".to_string()), ("limit", "50".into())];
                if let Some(a) = &after { q.push(("after", a.clone())); }
                let v = get("/me/following", &q).await?;
                let items = v.pointer("/artists/items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
                page.items.extend(items.iter().filter_map(|a| collection("artist", a, "Artista".into())));
                after = v.pointer("/artists/cursors/after").and_then(|a| a.as_str()).map(str::to_string);
                if after.is_none() || items.is_empty() { break; }
            }
        }
        _ => return Err(format!("biblioteca do Spotify desconhecida: {kind}")),
    }
    Ok(page)
}

pub async fn page(id: &str) -> Res<Page> {
    let mut parts = id.splitn(3, ':');
    let (_, kind, raw) = (parts.next(), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    match kind {
        "playlist" => {
            let v = get(&format!("/playlists/{raw}"), &[("fields", "name,description,owner(display_name),images".into())]).await?;
            let rows = paged(&format!("/playlists/{raw}/tracks"), &[("limit", "100".into()), ("fields", "items(track(id,name,type,duration_ms,explicit,external_ids,external_urls,artists(id,name),album(id,name,images))),next".into())], 50).await?;
            Ok(Page { kind: "playlist".into(), id: id.into(), title: s(&v, "name").unwrap_or_default(), subtitle: v.pointer("/owner/display_name").and_then(|o| o.as_str()).unwrap_or("").into(),
                description: s(&v, "description"), artwork: v.pointer("/images/0/url").and_then(|u| u.as_str()).map(str::to_string),
                tracks: rows.iter().filter_map(|i| i.get("track")).filter_map(|t| to_track(t, None)).collect(), ..Default::default() })
        }
        "album" => {
            let v = get(&format!("/albums/{raw}"), &[]).await?;
            let tracks = paged(&format!("/albums/{raw}/tracks"), &[("limit", "50".into())], 10).await?.iter().filter_map(|t| to_track(t, Some(&v))).collect();
            let by = v.pointer("/artists/0/name").and_then(|o| o.as_str()).unwrap_or("");
            Ok(Page { kind: "album".into(), id: id.into(), title: s(&v, "name").unwrap_or_default(), subtitle: format!("Álbum · {by} · {}", s(&v, "release_date").unwrap_or_default().chars().take(4).collect::<String>()),
                artwork: v.pointer("/images/0/url").and_then(|u| u.as_str()).map(str::to_string), tracks, ..Default::default() })
        }
        "artist" => {
            let v = get(&format!("/artists/{raw}"), &[]).await?;
            let albums = paged(&format!("/artists/{raw}/albums"), &[("limit", "50".into()), ("include_groups", "album,single".into())], 6).await.unwrap_or_default();
            let top = get(&format!("/artists/{raw}/top-tracks"), &[("market", "from_token".into())]).await.ok()
                .and_then(|t| t.get("tracks").and_then(|t| t.as_array()).cloned()).unwrap_or_default();
            Ok(Page { kind: "artist".into(), id: id.into(), title: s(&v, "name").unwrap_or_default(), subtitle: "Artista".into(),
                artwork: v.pointer("/images/0/url").and_then(|u| u.as_str()).map(str::to_string),
                tracks: top.iter().filter_map(|t| to_track(t, None)).collect(),
                items: albums.iter().filter_map(|a| collection("album", a, format!("{} · {}", s(a, "album_type").unwrap_or_default(), s(a, "release_date").unwrap_or_default().chars().take(4).collect::<String>()))).collect(), ..Default::default() })
        }
        _ => Err(format!("coleção do Spotify desconhecida: {id}")),
    }
}

/// Início do Spotify: recentes, top tracks, playlists e álbuns salvos.
pub async fn home() -> Res<Vec<Section>> {
    let top_query = [("limit", "20".to_string()), ("time_range", "short_term".to_string())];
    let (recent, top, pls, albums) = tokio::join!(library("history"), get("/me/top/tracks", &top_query), library("playlists"), library("albums"));
    let mut out = vec![];
    let list = |title: &str, tracks: Vec<TrackInfo>| (!tracks.is_empty()).then(|| Section { title: title.into(), label: Some("Spotify".into()), layout: "list".into(), items: tracks.into_iter().map(|t| Item { track: Some(t), collection: None }).collect(), more: None });
    let shelf = |title: &str, items: Vec<Item>| (!items.is_empty()).then(|| Section { title: title.into(), label: Some("Spotify".into()), layout: "carousel".into(), items, more: None });
    out.extend(list("Tocadas recentemente", recent.map(|p| p.tracks).unwrap_or_default()));
    out.extend(list("Suas mais ouvidas do mês", top.ok().and_then(|t| t.get("items").and_then(|i| i.as_array()).cloned()).unwrap_or_default().iter().filter_map(|t| to_track(t, None)).collect()));
    out.extend(shelf("Suas playlists", pls.map(|p| p.items).unwrap_or_default()));
    out.extend(shelf("Álbuns salvos", albums.map(|p| p.items).unwrap_or_default()));
    if out.is_empty() { return Err("o Spotify não devolveu nada para a sua Início".into()); }
    Ok(out)
}

pub async fn rate(track_id: &str, like: bool) -> Res<()> {
    request(if like { reqwest::Method::PUT } else { reqwest::Method::DELETE }, "/me/tracks", &[("ids", track_id.into())]).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn faixa_sem_id_e_ignorada() {
        let v = serde_json::json!({ "type": "track", "id": null, "name": "Local" });
        assert!(to_track(&v, None).is_none());
        let ok = serde_json::json!({ "type": "track", "id": "abc", "name": "Música", "artists": [{ "id": "z", "name": "Fulano" }], "duration_ms": 1000, "album": { "id": "al", "name": "Disco", "images": [{ "url": "u" }] } });
        let t = to_track(&ok, None).unwrap();
        assert_eq!((t.album_id.as_deref(), t.artist_id.as_deref(), t.album.as_deref()), (Some("sp:album:al"), Some("sp:artist:z"), Some("Disco")));
    }
}