//! Spotify pela API Web oficial, com login OAuth (PKCE) do próprio usuário: biblioteca, playlists, curtidas,
//! histórico recente e busca. O áudio **não** vem do Spotify (é protegido por DRM): as faixas tocam por
//! correspondência no YouTube Music / SoundCloud, como no Deezer.
//!
//! O MetroFuse usa os cookies do player web (`sp_dc`) e endpoints internos; aqui a escolha é o fluxo oficial,
//! que não depende de segredos embutidos no site. Cada pessoa cria um app em developer.spotify.com e informa o
//! Client ID uma vez (o fluxo PKCE não usa segredo).

use super::ytmusic::{CollectionRef, Item, Page, Section};
use crate::http::{err, CLIENT};
use crate::model::{now_ms, Res, TrackInfo};
use base64::Engine as _;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const API: &str = "https://api.spotify.com/v1";
const ACCOUNTS: &str = "https://accounts.spotify.com";
pub const REDIRECT: &str = "http://127.0.0.1:8899/callback";
const SCOPES: &str = "user-library-read user-library-modify playlist-read-private playlist-read-collaborative user-follow-read user-read-recently-played user-top-read user-read-private";

#[derive(Serialize, Deserialize, Clone, Default)]
struct State {
    client_id: String,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at_ms: u64,
}

static STATE: Lazy<RwLock<State>> = Lazy::new(|| RwLock::new(State::default()));
static FILE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status { pub has_client_id: bool, pub logged_in: bool, pub redirect: &'static str }

pub fn status() -> Status {
    let s = STATE.read();
    Status { has_client_id: !s.client_id.is_empty(), logged_in: s.refresh_token.is_some(), redirect: REDIRECT }
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
    { let mut s = STATE.write(); s.access_token = None; s.refresh_token = None; s.expires_at_ms = 0; }
    save();
}

// ───────── Login (PKCE)

pub struct Pkce { pub verifier: String, pub url: String }

fn b64(bytes: &[u8]) -> String { base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes) }

/// Prepara o login: guarda o Client ID e devolve o verificador e a URL de autorização.
pub fn begin(client_id: Option<String>) -> Res<Pkce> {
    if let Some(c) = client_id.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()) { STATE.write().client_id = c; save(); }
    let cid = STATE.read().client_id.clone();
    if cid.is_empty() { return Err("informe o Client ID do seu app do Spotify".into()); }
    let mut raw = vec![0u8; 48];
    rand::thread_rng().fill(&mut raw[..]);
    let verifier = b64(&raw);
    let challenge = b64(&Sha256::digest(verifier.as_bytes()));
    let url = format!(
        "{ACCOUNTS}/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}&code_challenge_method=S256&code_challenge={challenge}&show_dialog=true",
        urlencoding::encode(&cid), urlencoding::encode(REDIRECT), urlencoding::encode(SCOPES)
    );
    Ok(Pkce { verifier, url })
}

async fn token_request(form: &[(&str, String)]) -> Res<Value> {
    let resp = CLIENT.post(format!("{ACCOUNTS}/api/token")).form(form).send().await.map_err(err)?;
    let ok = resp.status().is_success();
    let v: Value = resp.json().await.map_err(err)?;
    if !ok { return Err(format!("Spotify: {}", v.get("error_description").or_else(|| v.get("error")).and_then(|e| e.as_str()).unwrap_or("login recusado"))); }
    Ok(v)
}

fn store_tokens(v: &Value) -> Res<()> {
    let at = v.get("access_token").and_then(|t| t.as_str()).ok_or("o Spotify não devolveu o token")?.to_string();
    let mut s = STATE.write();
    s.access_token = Some(at);
    if let Some(r) = v.get("refresh_token").and_then(|t| t.as_str()) { s.refresh_token = Some(r.to_string()); }
    s.expires_at_ms = now_ms() + v.get("expires_in").and_then(|e| e.as_u64()).unwrap_or(3600) * 1000 - 60_000;
    drop(s);
    save();
    Ok(())
}

pub async fn finish(code: &str, verifier: &str) -> Res<Me> {
    let cid = STATE.read().client_id.clone();
    let v = token_request(&[("grant_type", "authorization_code".into()), ("code", code.into()), ("redirect_uri", REDIRECT.into()), ("client_id", cid), ("code_verifier", verifier.into())]).await?;
    store_tokens(&v)?;
    match me().await { Ok(m) => Ok(m), Err(e) => { logout(); Err(e) } }
}

async fn refresh() -> Res<()> {
    let (cid, rt) = { let s = STATE.read(); (s.client_id.clone(), s.refresh_token.clone()) };
    let rt = rt.ok_or("entre na sua conta do Spotify primeiro")?;
    let v = token_request(&[("grant_type", "refresh_token".into()), ("refresh_token", rt), ("client_id", cid)]).await.inspect_err(|e| {
        if e.contains("invalid_grant") || e.contains("revoked") { logout(); }
    })?;
    store_tokens(&v)
}

async fn token() -> Res<String> {
    let expired = { let s = STATE.read(); s.access_token.is_none() || s.expires_at_ms <= now_ms() };
    if expired { refresh().await?; }
    STATE.read().access_token.clone().ok_or_else(|| "entre na sua conta do Spotify primeiro".to_string())
}

// ───────── API

async fn request(method: reqwest::Method, path: &str, query: &[(&str, String)]) -> Res<Value> {
    let url = if path.starts_with("http") { path.to_string() } else { format!("{API}{path}") };
    for attempt in 0..3 {
        let t = token().await?;
        let resp = CLIENT.request(method.clone(), &url).query(query).bearer_auth(t).header("Content-Length", "0").send().await.map_err(err)?;
        let status = resp.status();
        if status.as_u16() == 401 && attempt == 0 { refresh().await?; continue; }
        if status.as_u16() == 429 {
            let wait = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok()).unwrap_or(2).min(8);
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            continue;
        }
        if !status.is_success() {
            let body: Value = resp.json().await.unwrap_or(Value::Null);
            return Err(format!("Spotify HTTP {status}: {}", body.pointer("/error/message").and_then(|m| m.as_str()).unwrap_or("erro")));
        }
        return Ok(resp.json().await.unwrap_or(Value::Null));
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

/// `album_fallback`: faixas de um álbum não trazem o objeto do álbum.
fn to_track(t: &Value, album_fallback: Option<&Value>) -> Option<TrackInfo> {
    if t.get("type").and_then(|x| x.as_str()).map_or(false, |k| k != "track") { return None; }
    let id = s(t, "id")?; // faixas locais e indisponíveis não têm id
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
    Some(Item { track: None, collection: Some(CollectionRef {
        kind: kind.into(), id: format!("sp:{kind}:{id}"), title: s(v, "name")?, subtitle,
        artwork: v.pointer("/images/0/url").and_then(|u| u.as_str()).map(str::to_string),
    }) })
}

/// Percorre uma lista paginada (`items` + `next`) até `max` páginas.
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

/// Biblioteca: "songs", "playlists", "albums", "artists" ou "history".
pub async fn library(kind: &str) -> Res<Page> {
    let mut page = Page { kind: kind.into(), id: kind.into(), ..Default::default() };
    match kind {
        "songs" => page.tracks = paged("/me/tracks", &[("limit", "50".into())], 60).await?.iter().filter_map(|i| i.get("track")).filter_map(|t| to_track(t, None)).collect(),
        "history" => {
            let v = get("/me/player/recently-played", &[("limit", "50".into())]).await?;
            let mut seen_run: Option<String> = None;
            for i in v.get("items").and_then(|i| i.as_array()).into_iter().flatten() {
                if let Some(t) = i.get("track").and_then(|t| to_track(t, None)) {
                    if seen_run.as_deref() == Some(&t.id) { continue; } // a mesma faixa em sequência (repetição)
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

/// Página de uma coleção: `sp:playlist:<id>`, `sp:album:<id>` ou `sp:artist:<id>`.
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

/// Início do Spotify: o que você ouviu há pouco, suas mais ouvidas, playlists e álbuns salvos.
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
    fn pkce_challenge_bate_com_o_exemplo_da_rfc() {
        // RFC 7636, apêndice B
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(b64(&Sha256::digest(verifier.as_bytes())), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
    #[test]
    fn faixa_sem_id_e_ignorada() {
        let v = serde_json::json!({ "type": "track", "id": null, "name": "Local" });
        assert!(to_track(&v, None).is_none());
        let ok = serde_json::json!({ "type": "track", "id": "abc", "name": "Música", "artists": [{ "id": "z", "name": "Fulano" }], "duration_ms": 1000, "album": { "id": "al", "name": "Disco", "images": [{ "url": "u" }] } });
        let t = to_track(&ok, None).unwrap();
        assert_eq!((t.album_id.as_deref(), t.artist_id.as_deref(), t.album.as_deref()), (Some("sp:album:al"), Some("sp:artist:z"), Some("Disco")));
    }
}
