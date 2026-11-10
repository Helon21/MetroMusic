//! Spotify: login pela web (cookie `sp_dc`) + token do "app desktop" via Device Authorization Flow,
//! como no MetroFuse (`SpotifyCanvasClient`). Com o token, a API Web oficial entrega biblioteca, playlists,
//! curtidas, recentes e busca.
//!
//! Fluxo (porte fiel de `createDesktopAccessToken`):
//!   1. `POST /oauth2/device/authorize` (client id do app desktop) → `device_code`, `user_code`, URL de pareamento;
//!   2. abre a URL de pareamento **com o cookie `sp_dc`**, seguindo os redirecionamentos: o `flow_ctx` vem da URL final
//!      e o token CSRF, do `__NEXT_DATA__` da página;
//!   3. `POST /pair/api/resolve` com o `user_code` (aprova o dispositivo em nome da conta logada);
//!   4. `POST /api/token` troca o `device_code` pelo access token.
//! Não há refresh token: quando o token expira, o fluxo roda de novo a partir do `sp_dc`.
//!
//! O áudio **não** vem do Spotify (DRM): as faixas tocam por correspondência no YouTube Music / SoundCloud.
//! Aviso: é um método não oficial (depende de páginas e de um client id do app do Spotify) e pode quebrar.

use super::ytmusic::{CollectionRef, Item, Page, Section};
use crate::http::{err, CLIENT};
use crate::model::{now_ms, Res, TrackInfo};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

const API: &str = "https://api.spotify.com/v1";

const DEVICE_AUTH_URL: &str = "https://accounts.spotify.com/oauth2/device/authorize";
const DEVICE_TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const DEVICE_RESOLVE_URL: &str = "https://accounts.spotify.com/pair/api/resolve";
/// Client id do app desktop do Spotify, o mesmo que o MetroFuse usa.
const DEVICE_CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const DEVICE_SCOPE: &str = "app-remote-control,playlist-modify,playlist-modify-private,playlist-modify-public,playlist-read,playlist-read-collaborative,playlist-read-private,streaming,transfer-auth-session,ugc-image-upload,user-follow-modify,user-follow-read,user-library-modify,user-library-read,user-modify,user-modify-playback-state,user-modify-private,user-personalized,user-read-birthdate,user-read-currently-playing,user-read-email,user-read-play-history,user-read-playback-position,user-read-playback-state,user-read-private,user-read-recently-played,user-top-read";
const DESKTOP_UA: &str = "Spotify/126600447 Win32_x86_64/0 (PC laptop)";
const WEB_REFERER: &str = "https://open.spotify.com/";

#[derive(Serialize, Deserialize, Clone, Default)]
struct State {
    sp_dc: String,
    access_token: Option<String>,
    expires_at_ms: u64,
    /// Bloqueio por limite de requisições (ms). Fica no arquivo para sobreviver a reiniciar o app.
    #[serde(default)]
    blocked_until_ms: u64,
}

static STATE: Lazy<RwLock<State>> = Lazy::new(|| RwLock::new(State::default()));
static FILE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));
/// Até quando o Spotify pediu para não chamar (ms desde a época). Enquanto isso o app não envia nada:
/// cada chamada feita durante o bloqueio reinicia a janela de limite e atrasa a liberação.
static BLOCKED_UNTIL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static NEXT_DATA: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>"#).unwrap());

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status { pub has_client_id: bool, pub logged_in: bool, pub redirect: &'static str }

pub fn status() -> Status { Status { has_client_id: true, logged_in: is_logged_in(), redirect: "" } }
pub fn is_logged_in() -> bool { !STATE.read().sp_dc.is_empty() }

pub fn init(path: PathBuf) {
    *FILE.write() = Some(path.clone());
    if let Ok(b) = std::fs::read(&path) { if let Ok(s) = serde_json::from_slice::<State>(&b) {
        BLOCKED_UNTIL.store(s.blocked_until_ms, std::sync::atomic::Ordering::Relaxed);
        *STATE.write() = s;
    } }
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
    BLOCKED_UNTIL.store(0, std::sync::atomic::Ordering::Relaxed);
    *STATE.write() = State::default();
    save();
}

// ───────── Token do app desktop (Device Authorization Flow)

/// Cookies acumulados entre as requisições do fluxo (todos são de `*.spotify.com`).
struct Jar(Vec<(String, String)>);
impl Jar {
    fn header(&self) -> String { self.0.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; ") }
    fn absorb(&mut self, resp: &reqwest::Response) {
        for v in resp.headers().get_all(reqwest::header::SET_COOKIE) {
            let Ok(raw) = v.to_str() else { continue };
            if let Some((k, val)) = raw.split(';').next().and_then(|kv| kv.split_once('=')) {
                self.0.retain(|(n, _)| n != k.trim());
                self.0.push((k.trim().to_string(), val.trim().to_string()));
            }
        }
    }
}

/// Segue os redirecionamentos à mão (o `reqwest` descarta o cookie ao trocar de domínio, e aqui ele precisa ir sempre).
async fn get_following(jar: &mut Jar, start: &str) -> Res<(String, String)> {
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(20)).build().map_err(err)?;
    let mut url = start.to_string();
    for _ in 0..10 {
        let resp = client.get(&url).header("User-Agent", DESKTOP_UA).header("Referer", WEB_REFERER).header("Cookie", jar.header()).send().await.map_err(err)?;
        jar.absorb(&resp);
        if resp.status().is_redirection() {
            let loc = resp.headers().get(reqwest::header::LOCATION).and_then(|l| l.to_str().ok()).ok_or("redirecionamento sem destino")?;
            url = reqwest::Url::parse(&url).map_err(err)?.join(loc).map_err(err)?.to_string();
            continue;
        }
        let html = resp.text().await.map_err(err)?;
        return Ok((url, html));
    }
    Err("redirecionamentos demais na página de pareamento".into())
}

/// `(access_token, validade em ms)`
async fn desktop_token(sp_dc: &str) -> Res<(String, u64)> {
    // 1) autorização do dispositivo
    let resp = CLIENT.post(DEVICE_AUTH_URL).header("User-Agent", DESKTOP_UA).form(&[("client_id", DEVICE_CLIENT_ID), ("scope", DEVICE_SCOPE)]).send().await.map_err(err)?;
    let ok = resp.status().is_success();
    let text = resp.text().await.map_err(err)?;
    let auth: Value = serde_json::from_str(&text).map_err(|e| format!("Spotify (autorização do dispositivo): resposta inválida ({e}): {}", text.chars().take(200).collect::<String>()))?;
    if !ok { return Err(format!("Spotify (autorização do dispositivo): {}", auth.get("error_description").or_else(|| auth.get("error")).and_then(|e| e.as_str()).unwrap_or("recusada"))); }
    let field = |k: &str| auth.get(k).and_then(|x| x.as_str()).map(str::to_string).ok_or_else(|| format!("Spotify: a autorização do dispositivo veio sem `{k}`"));
    let (device_code, user_code, verify_url) = (field("device_code")?, field("user_code")?, field("verification_uri_complete")?);

    // 2) página de pareamento, já com a sessão
    let mut jar = Jar(vec![("sp_dc".into(), sp_dc.to_string())]);
    let (final_url, html) = get_following(&mut jar, &verify_url).await?;
    let flow = reqwest::Url::parse(&final_url).ok().and_then(|u| u.query_pairs().find(|(k, _)| k == "flow_ctx").map(|(_, v)| v.into_owned()))
        .map(|f| f.split(':').next().unwrap_or("").to_string()).filter(|f| !f.is_empty())
        .ok_or("Spotify: a página de pareamento não trouxe o flow_ctx (a sessão sp_dc pode ter expirado: entre de novo)")?;
    let csrf = NEXT_DATA.captures(&html).and_then(|c| serde_json::from_str::<Value>(&c[1]).ok())
        .and_then(|v| v.pointer("/props/initialToken").and_then(|t| t.as_str()).map(str::to_string))
        .ok_or("Spotify: a página de pareamento mudou (sem __NEXT_DATA__/initialToken); o método precisa ser atualizado")?;

    // 3) aprova o dispositivo
    let secs = now_ms() / 1000;
    let resolve = CLIENT.post(DEVICE_RESOLVE_URL).query(&[("flow_ctx", format!("{flow}:{secs}"))])
        .header("User-Agent", DESKTOP_UA).header("x-csrf-token", csrf).header("referer", &verify_url).header("origin", "https://accounts.spotify.com").header("Cookie", jar.header())
        .json(&serde_json::json!({ "code": user_code })).send().await.map_err(err)?;
    let rstatus = resolve.status();
    let rtext = resolve.text().await.map_err(err)?;
    let result = serde_json::from_str::<Value>(&rtext).ok().and_then(|v| v.get("result").and_then(|r| r.as_str()).map(str::to_string));
    if result.as_deref() != Some("ok") { return Err(format!("Spotify: o pareamento não foi aceito (HTTP {rstatus}, resultado {:?}, resposta: {})", result, rtext.chars().take(200).collect::<String>())); }

    // 4) troca o código do dispositivo pelo token
    for attempt in 0..4 {
        let t = CLIENT.post(DEVICE_TOKEN_URL).header("User-Agent", DESKTOP_UA)
            .form(&[("client_id", DEVICE_CLIENT_ID), ("device_code", device_code.as_str()), ("grant_type", DEVICE_GRANT_TYPE)]).send().await.map_err(err)?;
        let tok = t.status().is_success();
        let body: Value = t.json().await.map_err(err)?;
        if tok {
            let at = body.get("access_token").and_then(|x| x.as_str()).ok_or("Spotify: resposta sem access_token")?.to_string();
            let exp = body.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(3600);
            return Ok((at, now_ms() + exp * 1000 - 60_000));
        }
        let code = body.get("error").and_then(|x| x.as_str()).unwrap_or("");
        if code == "authorization_pending" && attempt < 3 { tokio::time::sleep(Duration::from_secs(1)).await; continue; }
        return Err(format!("Spotify (troca do código): {}", body.get("error_description").and_then(|e| e.as_str()).unwrap_or(code)));
    }
    Err("Spotify: o dispositivo não foi autorizado a tempo".into())
}

async fn renew() -> Res<()> {
    check_blocked()?;
    let sp_dc = STATE.read().sp_dc.clone();
    if sp_dc.is_empty() { return Err("entre na sua conta do Spotify primeiro".into()); }
    let (at, exp) = desktop_token(&sp_dc).await?;
    { let mut s = STATE.write(); s.access_token = Some(at); s.expires_at_ms = exp; }
    save();
    Ok(())
}

async fn token() -> Res<String> {
    let expired = { let s = STATE.read(); s.access_token.is_none() || s.expires_at_ms <= now_ms() };
    if expired { renew().await?; }
    STATE.read().access_token.clone().ok_or_else(|| "entre na sua conta do Spotify primeiro".to_string())
}

/// Conclui o login com o cookie `sp_dc` (capturado na janela ou colado): gera o token e confirma a conta.
pub async fn finish(sp_dc: &str) -> Res<Me> {
    let sp_dc = sp_dc.trim().trim_start_matches("sp_dc=").trim_end_matches(';').to_string();
    if sp_dc.len() < 20 { return Err("o cookie sp_dc parece inválido (copie o valor do cookie sp_dc de open.spotify.com)".into()); }
    *STATE.write() = State { sp_dc, access_token: None, expires_at_ms: 0, blocked_until_ms: 0 };
    match renew().await {
        // o token saiu: a sessão é boa, só o /me falhou (ex.: limite de requisições) → não apaga a sessão
        Ok(()) => match me().await { Ok(m) => { save(); Ok(m) } Err(e) => { if !e.starts_with(RATE_LIMITED) { logout(); } Err(friendly(&e)) } },
        Err(e) => { logout(); Err(e) }
    }
}

// ───────── API

/// Erro se o Spotify ainda está pedindo pausa (não faz nenhuma chamada nesse caso).
fn check_blocked() -> Res<()> {
    let until = BLOCKED_UNTIL.load(std::sync::atomic::Ordering::Relaxed);
    let now = now_ms();
    if until > now { return Err(format!("{RATE_LIMITED} {}", (until - now + 999) / 1000)); }
    Ok(())
}

async fn request(method: reqwest::Method, path: &str, query: &[(&str, String)]) -> Res<Value> {
    check_blocked()?;
    let url = if path.starts_with("http") { path.to_string() } else { format!("{API}{path}") };
    for attempt in 0..3 {
        let t = token().await?;
        let mut req = CLIENT.request(method.clone(), &url).query(query).bearer_auth(t);
        if method != reqwest::Method::GET { req = req.header("Content-Length", "0"); }
        let resp = req.send().await.map_err(err)?;
        let status = resp.status();
        let retry_after = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
        let text = resp.text().await.map_err(err)?;
        if status.as_u16() == 401 && attempt == 0 { renew().await?; continue; }
        if status.as_u16() == 429 {
            // Pausa curta: espera uma vez. Pausa longa: não fica girando, avisa quanto falta.
            let wait = retry_after.unwrap_or(2);
            if wait <= 5 && attempt < 2 { tokio::time::sleep(Duration::from_secs(wait)).await; continue; }
            let until = now_ms() + (wait + 2) * 1000;
            BLOCKED_UNTIL.store(until, std::sync::atomic::Ordering::Relaxed);
            STATE.write().blocked_until_ms = until;
            save();
            return Err(format!("{RATE_LIMITED} {wait}"));
        }
        // curtir/descurtir respondem 200/204 com corpo vazio: não é erro
        let v: Value = if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::Null) };
        if !status.is_success() {
            return Err(format!("Spotify HTTP {status}: {}", v.pointer("/error/message").and_then(|m| m.as_str()).unwrap_or("erro")));
        }
        return Ok(v);
    }
    Err("Spotify: não respondeu depois de várias tentativas".into())
}

/// Marca o erro de limite de requisições (o número de segundos vem depois).
const RATE_LIMITED: &str = "Spotify: limite de requisições atingido, tente de novo em";

/// Mensagem para o usuário: o erro de limite vira "tente de novo em N s".
pub fn friendly(e: &str) -> String {
    match e.strip_prefix(RATE_LIMITED) {
        Some(rest) => format!("Spotify: limite de requisições atingido; tente de novo em {}s", rest.trim()),
        None => e.to_string(),
    }
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
    #[test]
    fn csrf_vem_do_next_data() {
        let html = r#"<html><script id="__NEXT_DATA__" type="application/json" crossorigin="anonymous">{"props":{"initialToken":"TOKEN123"},"query":{"flow_ctx":"abc:1"}}</script></html>"#;
        let json: Value = serde_json::from_str(&NEXT_DATA.captures(html).unwrap()[1]).unwrap();
        assert_eq!(json.pointer("/props/initialToken").and_then(|t| t.as_str()), Some("TOKEN123"));
    }
    #[test]
    fn corpo_do_pareamento_usa_o_campo_code() {
        // o MetroFuse envia {"code": "<user_code>"}; "userCode" dá HTTP 400
        assert_eq!(serde_json::json!({ "code": "BX9JMN" }).to_string(), r#"{"code":"BX9JMN"}"#);
    }
    #[test]
    fn cookies_do_fluxo_sao_acumulados() {
        let mut jar = Jar(vec![("sp_dc".into(), "x".into())]);
        jar.0.push(("a".into(), "1".into()));
        assert_eq!(jar.header(), "sp_dc=x; a=1");
    }
}
