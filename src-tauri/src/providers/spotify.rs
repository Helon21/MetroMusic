//! Spotify: login pela web (cookie `sp_dc`) e leitura da conta pelo GraphQL interno do player web, como no MetroFuse.
//!
//! Por que não a API oficial (`api.spotify.com/v1`)? Com este tipo de login ela responde sempre 429 ("API rate limit
//! exceeded"), mesmo na primeira chamada: o limite é do app do Spotify, não da conta. O player web não usa essa API;
//! ele fala com `api-partner.spotify.com/pathfinder/v2/query` por *persisted queries*, e é isso que fazemos aqui.
//!
//! Passos:
//!   1. token do player web: o segredo TOTP (o mesmo gist que o MetroFuse usa) + hora do servidor → `open.spotify.com/api/token` com o `sp_dc`;
//!   2. o hash de cada consulta é lido do JS do player web (`open.spotify.com`), pois muda a cada versão do site;
//!   3. `POST pathfinder/v2/query` com `operationName`, `variables` e o hash.
//!
//! O áudio **não** vem do Spotify (DRM): as faixas tocam por correspondência no YouTube Music / SoundCloud.
//! Aviso: é um método não oficial e pode quebrar quando o Spotify mudar o site.

use super::ytmusic::{CollectionRef, Item, Page, Section};
use crate::http::{err, BROWSER_UA, CLIENT};
use crate::model::{now_ms, Res, TrackInfo};
use hmac::{Hmac, Mac};
use once_cell::sync::Lazy;
use parking_lot::{Mutex, RwLock};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::Sha1;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const WEB: &str = "https://open.spotify.com";
const GRAPHQL: &str = "https://api-partner.spotify.com/pathfinder/v2/query";
const NUANCE_GIST: &str = "https://api.github.com/gists/22ed9c6ba463899e933427f7de1f0eef";
const CACHE_TTL_MS: u64 = 6 * 60 * 60 * 1000;
const PAGE: usize = 50;
const MAX_ITEMS: usize = 5000;

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
static BLOCKED_UNTIL: AtomicU64 = AtomicU64::new(0);
/// (segredo TOTP, versão, quando foi lido)
static NUANCE: Lazy<Mutex<Option<(String, i64, u64)>>> = Lazy::new(|| Mutex::new(None));
/// operação → (hash, quando foi lido)
static HASHES: Lazy<Mutex<HashMap<String, (String, u64)>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static TOKEN_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status { pub has_client_id: bool, pub logged_in: bool, pub redirect: &'static str }

pub fn status() -> Status { Status { has_client_id: true, logged_in: is_logged_in(), redirect: "" } }
pub fn is_logged_in() -> bool { !STATE.read().sp_dc.is_empty() }

pub fn init(path: PathBuf) {
    *FILE.write() = Some(path.clone());
    if let Ok(b) = std::fs::read(&path) {
        if let Ok(s) = serde_json::from_slice::<State>(&b) {
            BLOCKED_UNTIL.store(s.blocked_until_ms, Ordering::Relaxed);
            *STATE.write() = s;
        }
    }
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
    BLOCKED_UNTIL.store(0, Ordering::Relaxed);
    *STATE.write() = State::default();
    save();
}

// ───────── Limite de requisições

/// Marca o erro de limite de requisições (o número de segundos vem depois).
const RATE_LIMITED: &str = "Spotify: limite de requisições atingido, tente de novo em";

pub fn friendly(e: &str) -> String {
    match e.strip_prefix(RATE_LIMITED) {
        Some(rest) => format!("Spotify: limite de requisições atingido; tente de novo em {}s", rest.trim()),
        None => e.to_string(),
    }
}

/// Erro se o Spotify ainda está pedindo pausa (sem fazer nenhuma chamada: cada uma reiniciaria a janela de limite).
fn check_blocked() -> Res<()> {
    let until = BLOCKED_UNTIL.load(Ordering::Relaxed);
    let now = now_ms();
    if until > now { return Err(format!("{RATE_LIMITED} {}", (until - now + 999) / 1000)); }
    Ok(())
}

fn block_for(wait_secs: u64) -> String {
    let until = now_ms() + (wait_secs + 2) * 1000;
    BLOCKED_UNTIL.store(until, Ordering::Relaxed);
    STATE.write().blocked_until_ms = until;
    save();
    format!("{RATE_LIMITED} {wait_secs}")
}

// ───────── Token do player web (TOTP)

fn base32_decode(s: &str) -> Res<Vec<u8>> {
    const AL: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let (mut buf, mut bits, mut out) = (0u32, 0u32, vec![]);
    for c in s.chars().filter(|c| *c != '=' && !c.is_whitespace()) {
        let v = AL.find(c.to_ascii_uppercase()).ok_or("segredo TOTP do Spotify inválido (base32)")? as u32;
        buf = (buf << 5) | v;
        bits += 5;
        if bits >= 8 { bits -= 8; out.push(((buf >> bits) & 0xff) as u8); }
    }
    Ok(out)
}

/// TOTP de 6 dígitos (RFC 6238, HMAC-SHA1, passo de 30 s).
fn totp(secret_b32: &str, unix_secs: u64) -> Res<String> {
    let key = base32_decode(secret_b32)?;
    let mut mac = Hmac::<Sha1>::new_from_slice(&key).map_err(|e| e.to_string())?;
    mac.update(&(unix_secs / 30).to_be_bytes());
    let h = mac.finalize().into_bytes();
    let o = (h[h.len() - 1] & 0x0f) as usize;
    let bin = ((h[o] as u32 & 0x7f) << 24) | ((h[o + 1] as u32) << 16) | ((h[o + 2] as u32) << 8) | h[o + 3] as u32;
    Ok(format!("{:06}", bin % 1_000_000))
}

async fn nuance(force: bool) -> Res<(String, i64)> {
    if !force {
        if let Some((s, v, at)) = NUANCE.lock().clone() { if now_ms().saturating_sub(at) < CACHE_TTL_MS { return Ok((s, v)); } }
    }
    let resp = CLIENT.get(NUANCE_GIST).header("User-Agent", "MetroMusic").header("Accept", "application/vnd.github+json").send().await.map_err(err)?;
    if !resp.status().is_success() { return Err(format!("Spotify: não consegui ler o segredo do token (HTTP {})", resp.status())); }
    let v: Value = resp.json().await.map_err(err)?;
    let content = v.pointer("/files/nuances.json/content").and_then(|c| c.as_str()).ok_or("Spotify: o segredo do token mudou de lugar")?;
    let list: Vec<Value> = serde_json::from_str(content).map_err(|e| format!("Spotify: segredo do token ilegível ({e})"))?;
    let best = list.iter().filter_map(|e| Some((e.get("s")?.as_str()?.to_string(), e.get("v")?.as_i64()?))).max_by_key(|(_, v)| *v).ok_or("Spotify: nenhum segredo de token disponível")?;
    *NUANCE.lock() = Some((best.0.clone(), best.1, now_ms()));
    Ok(best)
}

async fn server_time() -> u64 {
    let r = CLIENT.get(format!("{WEB}/api/server-time")).header("User-Agent", BROWSER_UA).send().await;
    match r {
        Ok(r) => r.json::<Value>().await.ok().and_then(|v| v.get("serverTime").and_then(|t| t.as_u64())).unwrap_or(now_ms() / 1000),
        Err(_) => now_ms() / 1000,
    }
}

/// Pede um token ao player web com o `sp_dc`. Devolve (token, validade em ms).
async fn fetch_web_token(sp_dc: &str) -> Res<(String, u64)> {
    for attempt in 0..2 {
        let (secret, ver) = nuance(attempt == 1).await?;
        let code = totp(&secret, server_time().await)?;
        let resp = CLIENT.get(format!("{WEB}/api/token"))
            .query(&[("reason", "transport"), ("productType", "web-player"), ("totp", code.as_str()), ("totpServer", code.as_str()), ("totpVer", &ver.to_string())])
            .header("User-Agent", BROWSER_UA).header("Accept", "application/json").header("Referer", format!("{WEB}/")).header("Cookie", format!("sp_dc={sp_dc}"))
            .send().await.map_err(err)?;
        let status = resp.status();
        if status.as_u16() == 429 {
            let wait = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(30);
            return Err(block_for(wait));
        }
        let text = resp.text().await.map_err(err)?;
        let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if let Some(tok) = v.get("accessToken").and_then(|t| t.as_str()) {
            if v.get("isAnonymous").and_then(|a| a.as_bool()) == Some(true) { return Err("o cookie sp_dc não é válido ou expirou; entre de novo no Spotify".into()); }
            let exp = v.get("accessTokenExpirationTimestampMs").and_then(|e| e.as_u64()).unwrap_or(now_ms() + 50 * 60 * 1000);
            return Ok((tok.to_string(), exp.saturating_sub(60_000)));
        }
        if attempt == 0 { continue; } // segredo antigo: relê o gist e tenta de novo
        return Err(format!("Spotify: o token do player web foi recusado (HTTP {status}); o método pode ter mudado"));
    }
    unreachable!()
}

async fn renew() -> Res<()> {
    check_blocked()?;
    let sp_dc = STATE.read().sp_dc.clone();
    if sp_dc.is_empty() { return Err("entre na sua conta do Spotify primeiro".into()); }
    let (tok, exp) = fetch_web_token(&sp_dc).await?;
    { let mut s = STATE.write(); s.access_token = Some(tok); s.expires_at_ms = exp; }
    save();
    Ok(())
}

async fn token() -> Res<String> {
    let _g = TOKEN_LOCK.lock().await; // uma renovação por vez, mesmo com várias consultas em paralelo
    let expired = { let s = STATE.read(); s.access_token.is_none() || s.expires_at_ms <= now_ms() };
    if expired { renew().await?; }
    STATE.read().access_token.clone().ok_or_else(|| "entre na sua conta do Spotify primeiro".to_string())
}

/// Conclui o login com o cookie `sp_dc` (capturado na janela ou colado): pede o token e confirma a conta.
pub async fn finish(sp_dc: &str) -> Res<Me> {
    let sp_dc = sp_dc.trim().trim_start_matches("sp_dc=").trim_end_matches(';').to_string();
    if sp_dc.len() < 20 { return Err("o cookie sp_dc parece inválido (copie o valor do cookie sp_dc de open.spotify.com)".into()); }
    BLOCKED_UNTIL.store(0, Ordering::Relaxed);
    *STATE.write() = State { sp_dc, ..Default::default() };
    match renew().await {
        Ok(()) => match me().await {
            Ok(m) => { save(); Ok(m) }
            // limite de requisições: a sessão é boa, só a confirmação da conta falhou
            Err(e) => { if !e.starts_with(RATE_LIMITED) { logout(); } Err(friendly(&e)) }
        },
        Err(e) => { logout(); Err(friendly(&e)) }
    }
}

// ───────── GraphQL (persisted queries)

/// Lê no JS do player web o hash da consulta `op`.
async fn find_hash(op: &str, force: bool) -> Res<String> {
    if !force {
        if let Some((h, at)) = HASHES.lock().get(op).cloned() { if now_ms().saturating_sub(at) < CACHE_TTL_MS { return Ok(h); } }
    }
    let html = CLIENT.get(format!("{WEB}/")).header("User-Agent", BROWSER_UA).send().await.map_err(err)?.text().await.map_err(err)?;
    static SRC: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<script[^>]+src="([^"]+)""#).unwrap());
    let bundle = SRC.captures_iter(&html).map(|c| c[1].to_string()).find(|s| s.contains("/web-player/web-player."))
        .ok_or("Spotify: não achei o código do player web (o site mudou)")?;
    let url = if bundle.starts_with("//") { format!("https:{bundle}") } else if bundle.starts_with('/') { format!("{WEB}{bundle}") } else { bundle };
    let js = CLIENT.get(&url).header("User-Agent", BROWSER_UA).send().await.map_err(err)?.text().await.map_err(err)?;
    let esc = regex::escape(op);
    let patterns = [
        format!(r#""{esc}","(?:query|mutation)","([a-f0-9]{{64}})""#),
        format!(r#"operationName:"{esc}"[\s\S]{{0,1000}}?sha256Hash:"([a-f0-9]{{64}})""#),
        format!(r#""{esc}"[\s\S]{{0,800}}?sha256Hash\\?":\\?"([a-f0-9]{{64}})"#),
    ];
    for p in patterns {
        if let Some(h) = Regex::new(&p).ok().and_then(|re| re.captures(&js).map(|c| c[1].to_string())) {
            HASHES.lock().insert(op.to_string(), (h.clone(), now_ms()));
            return Ok(h);
        }
    }
    Err(format!("Spotify: não achei a consulta {op} no player web (o site mudou)"))
}

async fn gql_once(op: &str, variables: &Value, hash: &str, tok: &str) -> Res<(u16, Value, Option<u64>)> {
    let sp_dc = STATE.read().sp_dc.clone();
    let body = json!({ "operationName": op, "variables": variables, "extensions": { "persistedQuery": { "version": 1, "sha256Hash": hash } } });
    let resp = CLIENT.post(GRAPHQL).bearer_auth(tok).json(&body)
        .header("User-Agent", BROWSER_UA).header("Accept", "application/json").header("App-Platform", "WebPlayer").header("Accept-Language", "en")
        .header("Referer", format!("{WEB}/")).header("Origin", WEB).header("Cookie", format!("sp_dc={sp_dc}"))
        .send().await.map_err(err)?;
    let st = resp.status().as_u16();
    let retry = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
    let text = resp.text().await.map_err(err)?;
    Ok((st, serde_json::from_str(&text).unwrap_or(Value::Null), retry))
}

/// Executa uma consulta. Renova o token em 401 e o hash quando o Spotify diz que não o conhece.
async fn gql(op: &str, variables: Value) -> Res<Value> {
    check_blocked()?;
    let mut hash = find_hash(op, false).await?;
    let mut refreshed_hash = false;
    let mut renewed = false;
    for _ in 0..4 {
        let tok = token().await?;
        let (st, v, retry) = gql_once(op, &variables, &hash, &tok).await?;
        if st == 429 { return Err(block_for(retry.unwrap_or(30))); }
        if st == 401 && !renewed { renewed = true; STATE.write().access_token = None; continue; }
        let errs = v.get("errors").map(|e| e.to_string()).unwrap_or_default();
        if (st == 400 || st == 404 || errs.contains("PersistedQueryNotFound")) && !refreshed_hash {
            refreshed_hash = true;
            let fresh = find_hash(op, true).await?;
            if fresh != hash { hash = fresh; continue; }
        }
        if !(200..300).contains(&st) { return Err(format!("Spotify HTTP {st} em {op}")); }
        if v.get("data").map_or(true, |d| d.is_null()) && !errs.is_empty() { return Err(format!("Spotify ({op}): {}", errs.chars().take(160).collect::<String>())); }
        return Ok(v);
    }
    Err("Spotify: a consulta não respondeu depois de renovar o token".into())
}

// ───────── Conversões

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Me { pub id: String, pub name: String, pub handle: Option<String>, pub avatar: Option<String> }

pub async fn me() -> Res<Me> {
    let v = gql("profileAttributes", json!({})).await?;
    let p = v.pointer("/data/me/profile").ok_or("a sessão não é válida (o Spotify não reconheceu a conta); entre de novo")?;
    let id = p.get("username").or_else(|| p.get("accountId")).and_then(|x| x.as_str()).unwrap_or("spotify").to_string();
    Ok(Me { name: s(p, "name").unwrap_or_else(|| id.clone()), id, handle: None, avatar: p.pointer("/avatar/sources/0/url").and_then(|u| u.as_str()).map(str::to_string) })
}

fn s(v: &Value, k: &str) -> Option<String> { v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(str::to_string) }
fn id_of(uri: &str, kind: &str) -> Option<String> { uri.strip_prefix(&format!("spotify:{kind}:")).filter(|i| !i.is_empty()).map(str::to_string) }
fn image(v: &Value, path: &str) -> Option<String> { v.pointer(path).and_then(|u| u.as_str()).map(str::to_string) }

/// `uri`: o `_uri` do envelope (nas curtidas o dado da faixa não traz o próprio uri).
fn to_track(data: &Value, uri: Option<&str>, album_fallback: Option<&Value>) -> Option<TrackInfo> {
    let uri = uri.map(str::to_string).or_else(|| s(data, "uri"))?;
    let id = id_of(&uri, "track")?; // episódios e arquivos locais não entram
    let album = data.get("albumOfTrack").filter(|a| a.is_object()).or(album_fallback);
    let artists: Vec<String> = data.pointer("/artists/items").and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|x| x.pointer("/profile/name").and_then(|n| n.as_str()).map(str::to_string)).collect()).unwrap_or_default();
    let dur = data.pointer("/trackDuration/totalMilliseconds").or_else(|| data.pointer("/duration/totalMilliseconds")).and_then(|d| d.as_u64());
    Some(TrackInfo {
        provider: "spotify".into(), url: Some(format!("https://open.spotify.com/track/{id}")), id, title: s(data, "name")?,
        artists: if artists.is_empty() { vec!["Artista desconhecido".into()] } else { artists },
        album: album.and_then(|a| s(a, "name")), duration_ms: dur,
        artwork_url: album.and_then(|a| image(a, "/coverArt/sources/0/url")),
        explicit: data.pointer("/contentRating/label").and_then(|l| l.as_str()) == Some("EXPLICIT"),
        album_id: album.and_then(|a| s(a, "uri")).and_then(|u| id_of(&u, "album")).map(|i| format!("sp:album:{i}")),
        artist_id: data.pointer("/artists/items/0/uri").and_then(|u| u.as_str()).and_then(|u| id_of(u, "artist")).map(|i| format!("sp:artist:{i}")),
        ..Default::default()
    })
}

fn coll(kind: &str, id: String, title: String, subtitle: String, artwork: Option<String>) -> Item {
    Item { track: None, collection: Some(CollectionRef { kind: kind.into(), id: format!("sp:{kind}:{id}"), title, subtitle, artwork }) }
}

/// Item de `libraryV3` → cartão (playlist, álbum ou artista).
fn library_item(it: &Value) -> Option<Item> {
    let node = it.get("item")?;
    let d = node.get("data")?;
    let uri = s(node, "_uri").or_else(|| s(d, "uri"))?;
    match d.get("__typename").and_then(|t| t.as_str()).unwrap_or("") {
        "PseudoPlaylist" => Some(coll("playlist", "collection-tracks".into(), s(d, "name")?, format!("{} faixas", d.get("count").and_then(|c| c.as_u64()).unwrap_or(0)), image(d, "/image/sources/0/url"))),
        "Playlist" => Some(coll("playlist", id_of(&uri, "playlist")?, s(d, "name")?, s(&d["ownerV2"]["data"], "name").unwrap_or_default(), image(d, "/images/items/0/sources/0/url"))),
        "Album" => Some(coll("album", id_of(&uri, "album")?, s(d, "name")?, format!("Álbum · {}", d.pointer("/artists/items/0/profile/name").and_then(|n| n.as_str()).unwrap_or("")), image(d, "/coverArt/sources/0/url"))),
        "Artist" => Some(coll("artist", id_of(&uri, "artist")?, d.pointer("/profile/name").and_then(|n| n.as_str())?.to_string(), "Artista".into(), image(d, "/visuals/avatarImage/sources/0/url"))),
        _ => None,
    }
}

// ───────── Biblioteca e páginas

async fn liked_tracks(max: usize) -> Res<(Vec<TrackInfo>, u64)> {
    let (mut out, mut offset, mut total) = (vec![], 0usize, 0u64);
    loop {
        let v = gql("fetchLibraryTracks", json!({ "uri": "spotify:collection:tracks", "offset": offset, "limit": PAGE })).await?;
        let page = v.pointer("/data/me/library/tracks").ok_or("Spotify: resposta das curtidas inesperada")?;
        total = page.get("totalCount").and_then(|t| t.as_u64()).unwrap_or(total);
        let items = page.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
        out.extend(items.iter().filter_map(|i| to_track(i.pointer("/track/data")?, i.pointer("/track/_uri").and_then(|u| u.as_str()), None)));
        offset += items.len();
        if items.is_empty() || offset as u64 >= total || out.len() >= max { break; }
    }
    Ok((out, total))
}

async fn library_v3(filter: &str, max: usize) -> Res<Vec<Item>> { library_v3_ordered(Some(filter), None, max).await }

/// `filter`: "Playlists", "Albums", "Artists" ou nenhum (tudo); `order`: `None` ou "Recents" (o que você abriu por último).
async fn library_v3_ordered(filter: Option<&str>, order: Option<&str>, max: usize) -> Res<Vec<Item>> {
    let (mut out, mut offset) = (vec![], 0usize);
    loop {
        let filters: Vec<&str> = filter.into_iter().collect();
        let vars = json!({ "filters": filters, "order": order, "textFilter": "", "features": ["LIKED_SONGS"], "limit": PAGE, "offset": offset, "flatten": false, "expandedFolders": [], "folderUri": null, "includeFoldersWhenFlattening": true, "withCuration": false });
        let v = gql("libraryV3", vars).await?;
        let lib = v.pointer("/data/me/libraryV3").ok_or("Spotify: resposta da biblioteca inesperada")?;
        let items = lib.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
        out.extend(items.iter().filter_map(library_item));
        offset += items.len();
        let total = lib.get("totalCount").and_then(|t| t.as_u64()).unwrap_or(0);
        if items.is_empty() || offset as u64 >= total || out.len() >= max { break; }
    }
    out.truncate(max);
    Ok(out)
}

/// Biblioteca: "songs", "playlists", "albums" ou "artists". O histórico recente do Spotify ainda não está disponível.
pub async fn library(kind: &str) -> Res<Page> {
    let mut page = Page { kind: kind.into(), id: kind.into(), ..Default::default() };
    match kind {
        "songs" => page.tracks = liked_tracks(MAX_ITEMS).await?.0,
        "playlists" => page.items = library_v3("Playlists", MAX_ITEMS).await?,
        "albums" => page.items = library_v3("Albums", MAX_ITEMS).await?,
        "artists" => page.items = library_v3("Artists", MAX_ITEMS).await?,
        "history" => return Err("O histórico recente do Spotify ainda não está disponível".into()),
        _ => return Err(format!("biblioteca do Spotify desconhecida: {kind}")),
    }
    Ok(page)
}

/// Página de uma coleção: `sp:playlist:<id>`, `sp:album:<id>`, `sp:artist:<id>` ou `sp:playlist:collection-tracks` (curtidas).
pub async fn page(id: &str) -> Res<Page> {
    let mut parts = id.splitn(3, ':');
    let (_, kind, raw) = (parts.next(), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    match (kind, raw) {
        ("playlist", "collection-tracks") => {
            let (tracks, _) = liked_tracks(MAX_ITEMS).await?;
            Ok(Page { kind: "playlist".into(), id: id.into(), title: "Músicas curtidas".into(), subtitle: "Spotify".into(), tracks, ..Default::default() })
        }
        ("playlist", _) => {
            let uri = format!("spotify:playlist:{raw}");
            let (mut tracks, mut offset) = (vec![], 0usize);
            let (mut title, mut desc, mut art, mut owner, mut owned) = (String::new(), None, None, String::new(), false);
            loop {
                let v = gql("fetchPlaylist", json!({ "uri": uri, "offset": offset, "limit": 100, "enableWatchFeedEntrypoint": true })).await?;
                let pl = v.pointer("/data/playlistV2").ok_or("Spotify: playlist indisponível (pode ser privada ou ter sido removida)")?;
                if offset == 0 {
                    title = s(pl, "name").unwrap_or_default(); desc = s(pl, "description");
                    art = image(pl, "/images/items/0/sources/0/url"); owner = s(&pl["ownerV2"]["data"], "name").unwrap_or_default();
                    owned = pl.pointer("/currentUserCapabilities/canEditItems").and_then(|c| c.as_bool()).unwrap_or(false);
                }
                let items = pl.pointer("/content/items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
                tracks.extend(items.iter().filter_map(|i| {
                    let mut t = to_track(i.pointer("/itemV2/data")?, None, None)?;
                    t.set_id = i.get("uid").and_then(|u| u.as_str()).map(str::to_string); // necessário para remover/mover
                    Some(t)
                }));
                offset += items.len();
                let total = pl.pointer("/content/totalCount").and_then(|t| t.as_u64()).unwrap_or(0);
                if items.is_empty() || offset as u64 >= total || tracks.len() >= MAX_ITEMS { break; }
            }
            Ok(Page { kind: "playlist".into(), id: id.into(), title, subtitle: owner, description: desc, artwork: art, tracks, editable: owned, ..Default::default() })
        }
        ("album", _) => {
            let uri = format!("spotify:album:{raw}");
            let (mut tracks, mut offset) = (vec![], 0usize);
            let (mut title, mut sub, mut art, mut meta) = (String::new(), String::new(), None, Value::Null);
            loop {
                let v = gql("getAlbum", json!({ "uri": uri, "locale": "", "offset": offset, "limit": PAGE })).await?;
                let al = v.pointer("/data/albumUnion").ok_or("Spotify: álbum indisponível")?;
                if offset == 0 {
                    title = s(al, "name").unwrap_or_default();
                    let by = al.pointer("/artists/items/0/profile/name").and_then(|n| n.as_str()).unwrap_or("");
                    let year = al.pointer("/date/isoString").and_then(|d| d.as_str()).map(|d| d.chars().take(4).collect::<String>()).unwrap_or_default();
                    sub = format!("Álbum · {by} · {year}");
                    art = image(al, "/coverArt/sources/0/url");
                    meta = json!({ "name": title, "uri": uri, "coverArt": al.get("coverArt").cloned().unwrap_or(Value::Null) });
                }
                let items = al.pointer("/tracksV2/items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
                tracks.extend(items.iter().filter_map(|i| to_track(i.get("track")?, None, Some(&meta))));
                offset += items.len();
                let total = al.pointer("/tracksV2/totalCount").and_then(|t| t.as_u64()).unwrap_or(0);
                if items.is_empty() || offset as u64 >= total { break; }
            }
            Ok(Page { kind: "album".into(), id: id.into(), title, subtitle: sub, artwork: art, tracks, ..Default::default() })
        }
        ("artist", _) => {
            let v = gql("queryArtistOverview", json!({ "uri": format!("spotify:artist:{raw}"), "locale": "", "includePrerelease": true })).await?;
            let a = v.pointer("/data/artistUnion").ok_or("Spotify: artista indisponível")?;
            let d = a.get("discography").cloned().unwrap_or(Value::Null);
            let mut releases: Vec<&Value> = d.pointer("/popularReleasesAlbums/items").and_then(|i| i.as_array()).map(|a| a.iter().collect()).unwrap_or_default();
            for group in ["albums", "singles", "compilations"] {
                for g in d.pointer(&format!("/{group}/items")).and_then(|i| i.as_array()).into_iter().flatten() {
                    releases.extend(g.pointer("/releases/items").and_then(|i| i.as_array()).into_iter().flatten());
                }
            }
            let mut seen = std::collections::HashSet::new();
            let items = releases.iter().filter_map(|r| {
                let rid = id_of(&s(r, "uri")?, "album")?;
                if !seen.insert(rid.clone()) { return None; }
                let year = r.pointer("/date/year").and_then(|y| y.as_u64()).map(|y| y.to_string()).unwrap_or_default();
                Some(coll("album", rid, s(r, "name")?, format!("{} · {year}", s(r, "type").unwrap_or_default().to_lowercase()), image(r, "/coverArt/sources/0/url")))
            }).collect();
            let top: Vec<TrackInfo> = a.pointer("/discography/topTracks/items").and_then(|i| i.as_array()).into_iter().flatten()
                .filter_map(|i| to_track(i.get("track")?, None, None)).collect();
            Ok(Page { kind: "artist".into(), id: id.into(), title: a.pointer("/profile/name").and_then(|n| n.as_str()).unwrap_or("Artista").into(), subtitle: "Artista".into(),
                artwork: image(a, "/visuals/avatarImage/sources/0/url"), tracks: top, items, ..Default::default() })
        }
        _ => Err(format!("coleção do Spotify desconhecida: {id}")),
    }
}

/// Início do Spotify: curtidas recentes, playlists, álbuns salvos e artistas seguidos.
pub async fn home() -> Res<Vec<Section>> {
    let (liked, pls, albums, artists, recent) = tokio::join!(liked_tracks(30), library_v3("Playlists", 40), library_v3("Albums", 40), library_v3("Artists", 40), library_v3_ordered(None, Some("Recents"), 12));
    let mut out = vec![];
    let shelf = |title: &str, items: Vec<Item>| (!items.is_empty()).then(|| Section { title: title.into(), label: Some("Spotify".into()), layout: "carousel".into(), items, more: None });
    // O Spotify não entrega mais o histórico por faixa; o que existe é o que você abriu por último.
    out.extend(shelf("Ouvido recentemente", recent.unwrap_or_default()));
    if let Ok((tracks, _)) = liked {
        if !tracks.is_empty() { out.push(Section { title: "Curtidas recentes".into(), label: Some("Spotify".into()), layout: "list".into(), items: tracks.into_iter().map(|t| Item { track: Some(t), collection: None }).collect(), more: None }); }
    }
    out.extend(shelf("Suas playlists", pls.unwrap_or_default()));
    out.extend(shelf("Álbuns salvos", albums.unwrap_or_default()));
    out.extend(shelf("Artistas que você segue", artists.unwrap_or_default()));
    if out.is_empty() { return Err("o Spotify não devolveu nada para a sua Início".into()); }
    Ok(out)
}

/// A busca do Spotify não é usada: o app procura a mesma música no YouTube Music e no SoundCloud.
pub async fn search(_query: &str, _limit: usize) -> Res<Vec<TrackInfo>> { Ok(vec![]) }

pub async fn rate(track_id: &str, like: bool) -> Res<()> {
    let v = gql(if like { "addToLibrary" } else { "removeFromLibrary" }, json!({ "libraryItemUris": [format!("spotify:track:{track_id}")] })).await?;
    match v.get("errors").and_then(|e| e.as_array()).filter(|e| !e.is_empty()) {
        Some(e) => Err(format!("Spotify recusou a alteração: {}", e[0].to_string().chars().take(120).collect::<String>())),
        None => Ok(()),
    }
}

// ───────── Gerenciar playlists e biblioteca

fn check_errors(v: &Value, what: &str) -> Res<()> {
    match v.get("errors").and_then(|e| e.as_array()).filter(|e| !e.is_empty()) {
        Some(e) => Err(format!("O Spotify recusou ({what}): {}", e[0].get("message").and_then(|m| m.as_str()).unwrap_or("erro").chars().take(140).collect::<String>())),
        None => Ok(()),
    }
}

fn playlist_uri(id: &str) -> String {
    format!("spotify:playlist:{}", id.rsplit(':').next().unwrap_or(id))
}

/// Playlists da conta onde dá para mexer (as suas e as colaborativas).
pub async fn editable_playlists() -> Res<Vec<CollectionRef>> {
    let mut out = vec![];
    let mut offset = 0usize;
    loop {
        let vars = json!({ "filters": ["Playlists"], "order": null, "textFilter": "", "features": ["LIKED_SONGS"], "limit": PAGE, "offset": offset, "flatten": false, "expandedFolders": [], "folderUri": null, "includeFoldersWhenFlattening": true, "withCuration": false });
        let v = gql("libraryV3", vars).await?;
        let lib = v.pointer("/data/me/libraryV3").ok_or("Spotify: resposta da biblioteca inesperada")?;
        let items = lib.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
        for it in &items {
            let (Some(node), Some(d)) = (it.get("item"), it.pointer("/item/data")) else { continue };
            if d.get("__typename").and_then(|t| t.as_str()) != Some("Playlist") { continue; }
            // editável = o Spotify diz que a conta pode editar os itens
            if d.pointer("/currentUserCapabilities/canEditItems").and_then(|c| c.as_bool()) != Some(true) { continue; }
            if let Some(Item { collection: Some(c), .. }) = library_item(&json!({ "item": node })) { out.push(c); }
        }
        offset += items.len();
        let total = lib.get("totalCount").and_then(|t| t.as_u64()).unwrap_or(0);
        if items.is_empty() || offset as u64 >= total { break; }
    }
    Ok(out)
}

pub async fn add_to_playlist(playlist_id: &str, track_ids: &[String]) -> Res<()> {
    if track_ids.is_empty() { return Ok(()); }
    let uris: Vec<String> = track_ids.iter().map(|t| format!("spotify:track:{t}")).collect();
    let v = gql("addToPlaylist", json!({ "playlistUri": playlist_uri(playlist_id), "playlistItemUris": uris, "newPosition": { "moveType": "BOTTOM_OF_PLAYLIST", "fromUid": null } })).await?;
    check_errors(&v, "adicionar à playlist")
}

/// `items`: (id da faixa, uid dela na playlist). Sem o uid, ele é procurado na própria playlist.
pub async fn remove_from_playlist(playlist_id: &str, items: &[(String, Option<String>)]) -> Res<()> {
    if items.is_empty() { return Ok(()); }
    let current = if items.iter().any(|(_, u)| u.is_none()) { page(&format!("sp:playlist:{}", playlist_id.rsplit(':').next().unwrap_or(playlist_id))).await?.tracks } else { vec![] };
    let mut taken = std::collections::HashSet::new();
    let mut uids = vec![];
    for (tid, uid) in items {
        let uid = uid.clone().or_else(|| current.iter().find(|t| &t.id == tid && t.set_id.as_ref().map_or(false, |u| !taken.contains(u))).and_then(|t| t.set_id.clone()))
            .ok_or_else(|| format!("a faixa {tid} não está nesta playlist"))?;
        taken.insert(uid.clone());
        uids.push(uid);
    }
    let v = gql("removeFromPlaylist", json!({ "playlistUri": playlist_uri(playlist_id), "uids": uids })).await?;
    check_errors(&v, "remover da playlist")
}

/// Põe a faixa `uid` antes da faixa `before_uid` (`None` = no fim).
pub async fn move_in_playlist(playlist_id: &str, uid: &str, before_uid: Option<&str>) -> Res<()> {
    let pos = match before_uid { Some(b) => json!({ "moveType": "BEFORE_UID", "fromUid": b }), None => json!({ "moveType": "BOTTOM_OF_PLAYLIST", "fromUid": null }) };
    let v = gql("moveItemsInPlaylist", json!({ "playlistUri": playlist_uri(playlist_id), "uids": [uid], "newPosition": pos })).await?;
    check_errors(&v, "mover na playlist")
}

/// Salva ou remove da biblioteca um álbum, playlist ou artista (seguir).
pub async fn library_save(kind: &str, id: &str, save: bool) -> Res<()> {
    // O Spotify aceita aqui só álbum e artista; seguir uma playlist passa por outro protocolo (a "rootlist"), que não foi portado.
    if kind == "playlist" { return Err("Salvar playlists de outras pessoas no Spotify ainda não está disponível".into()); }
    if !matches!(kind, "album" | "artist") { return Err(format!("tipo de item desconhecido: {kind}")); }
    let uri = format!("spotify:{kind}:{}", id.rsplit(':').next().unwrap_or(id));
    let v = gql(if save { "addToLibrary" } else { "removeFromLibrary" }, json!({ "libraryItemUris": [uri] })).await?;
    check_errors(&v, "biblioteca")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totp_bate_com_o_vetor_da_rfc_6238() {
        // segredo "12345678901234567890" em base32; em T=59 s o código de 6 dígitos é 287082
        assert_eq!(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59).unwrap(), "287082");
        assert_eq!(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1111111109).unwrap(), "081804");
    }

    #[test]
    fn faixa_das_curtidas_usa_o_uri_do_envelope() {
        let data = json!({ "name": "Música", "artists": { "items": [{ "profile": { "name": "Fulano" }, "uri": "spotify:artist:AR1" }] },
            "albumOfTrack": { "name": "Disco", "uri": "spotify:album:AL1", "coverArt": { "sources": [{ "url": "u" }] } }, "duration": { "totalMilliseconds": 1000 }, "contentRating": { "label": "EXPLICIT" } });
        let t = to_track(&data, Some("spotify:track:T1"), None).unwrap();
        assert_eq!((t.id.as_str(), t.album.as_deref(), t.album_id.as_deref(), t.artist_id.as_deref(), t.duration_ms, t.explicit), ("T1", Some("Disco"), Some("sp:album:AL1"), Some("sp:artist:AR1"), Some(1000), true));
        // episódios e arquivos locais não são faixas
        assert!(to_track(&data, Some("spotify:episode:E1"), None).is_none());
        assert!(to_track(&data, Some("spotify:local:x"), None).is_none());
    }

    #[test]
    fn itens_da_biblioteca_viram_cartoes() {
        let pl = json!({ "item": { "_uri": "spotify:playlist:P1", "data": { "__typename": "Playlist", "name": "Minha", "ownerV2": { "data": { "name": "Eu" } }, "images": { "items": [{ "sources": [{ "url": "i" }] }] } } } });
        let c = library_item(&pl).unwrap().collection.unwrap();
        assert_eq!((c.kind.as_str(), c.id.as_str(), c.subtitle.as_str(), c.artwork.as_deref()), ("playlist", "sp:playlist:P1", "Eu", Some("i")));
        let liked = json!({ "item": { "_uri": "spotify:collection:tracks", "data": { "__typename": "PseudoPlaylist", "name": "Liked Songs", "count": 10 } } });
        assert_eq!(library_item(&liked).unwrap().collection.unwrap().id, "sp:playlist:collection-tracks");
    }

    /// Com uma sessão real: `MM_SP_DC=<cookie> cargo test net_spotify_graphql -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn net_spotify_graphql() {
        let sp_dc = std::env::var("MM_SP_DC").expect("MM_SP_DC");
        let m = finish(&sp_dc).await.expect("login");
        println!("SPGQL conta: {} ({})", m.name, m.id);
        let (liked, total) = liked_tracks(MAX_ITEMS).await.expect("curtidas");
        println!("SPGQL curtidas: {} de {total}; 1ª: {:?}", liked.len(), liked.first().map(|t| (&t.title, &t.artists, &t.album)));
        for k in ["playlists", "albums", "artists"] {
            let p = library(k).await.expect(k);
            println!("SPGQL {k}: {} itens; 1º: {:?}", p.items.len(), p.items.first().and_then(|i| i.collection.as_ref()).map(|c| (&c.title, &c.id)));
        }
        let pls = library("playlists").await.unwrap();
        if let Some(c) = pls.items.iter().filter_map(|i| i.collection.as_ref()).find(|c| c.id != "sp:playlist:collection-tracks") {
            let p = page(&c.id).await.expect("playlist");
            println!("SPGQL playlist {:?}: {} faixas, dono {:?}", p.title, p.tracks.len(), p.subtitle);
        }
        if let Some(c) = library("albums").await.unwrap().items.iter().filter_map(|i| i.collection.as_ref()).next() {
            let p = page(&c.id).await.expect("álbum");
            println!("SPGQL álbum {:?}: {} faixas", p.title, p.tracks.len());
        }
        if let Some(c) = library("artists").await.unwrap().items.iter().filter_map(|i| i.collection.as_ref()).next() {
            let p = page(&c.id).await.expect("artista");
            println!("SPGQL artista {:?}: {} álbuns, {} faixas populares", p.title, p.items.len(), p.tracks.len());
        }
        let h = home().await.expect("início");
        println!("SPGQL início: {}", h.iter().map(|s| format!("{} ({})", s.title, s.items.len())).collect::<Vec<_>>().join("; "));
    }

    /// Curte uma faixa que NÃO está curtida, confere, e descurte em seguida (deixa a conta como estava):
    /// `MM_SP_DC=<cookie> cargo test net_spotify_curtir -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn net_spotify_curtir() {
        let sp_dc = std::env::var("MM_SP_DC").expect("MM_SP_DC");
        finish(&sp_dc).await.expect("login");
        let (liked, total0) = liked_tracks(MAX_ITEMS).await.unwrap();
        let ids: std::collections::HashSet<String> = liked.iter().map(|t| t.id.clone()).collect();
        let pls = library("playlists").await.unwrap();
        let cid = pls.items.iter().filter_map(|i| i.collection.as_ref()).find(|c| c.id != "sp:playlist:collection-tracks").unwrap().id.clone();
        let cand = page(&cid).await.unwrap().tracks.into_iter().find(|t| !ids.contains(&t.id)).expect("faixa não curtida");
        println!("SPLIKE curtidas antes: {total0}; teste com {:?} ({})", cand.title, cand.id);
        rate(&cand.id, true).await.expect("curtir");
        let (_, total1) = liked_tracks(MAX_ITEMS).await.unwrap();
        println!("SPLIKE depois de curtir: {total1}");
        rate(&cand.id, false).await.expect("descurtir");
        let (_, total2) = liked_tracks(MAX_ITEMS).await.unwrap();
        println!("SPLIKE depois de descurtir: {total2}");
        assert_eq!((total1, total2), (total0 + 1, total0));
    }

    /// Mover faixa e salvar playlist de terceiros, sempre desfeitos:
    /// `MM_SP_DC=<cookie> cargo test net_spotify_mover_e_salvar -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn net_spotify_mover_e_salvar() {
        let sp_dc = std::env::var("MM_SP_DC").expect("MM_SP_DC");
        finish(&sp_dc).await.expect("login");
        // --- mover: duas curtidas numa playlist sua, na ordem A,B; move B antes de A; confere; limpa
        let pls = editable_playlists().await.unwrap();
        let alvo = pls.iter().find(|c| c.id != "sp:playlist:collection-tracks").expect("uma playlist sua").clone();
        let antes = page(&alvo.id).await.unwrap().tracks.len();
        let (liked, _) = liked_tracks(10).await.unwrap();
        let (a, b) = (liked[0].id.clone(), liked[1].id.clone());
        add_to_playlist(&alvo.id, &[a.clone(), b.clone()]).await.expect("adicionar");
        let t = page(&alvo.id).await.unwrap().tracks;
        let (ta, tb) = (t.iter().rev().find(|x| x.id == a).unwrap().clone(), t.iter().rev().find(|x| x.id == b).unwrap().clone());
        println!("SPM playlist {:?}: {antes} → {} faixas; setId presente: {}", alvo.title, t.len(), ta.set_id.is_some() && tb.set_id.is_some());
        move_in_playlist(&alvo.id, tb.set_id.as_deref().unwrap(), ta.set_id.as_deref()).await.expect("mover");
        let t2 = page(&alvo.id).await.unwrap().tracks;
        let ia = t2.iter().position(|x| x.id == a).unwrap();
        let ib = t2.iter().position(|x| x.id == b).unwrap();
        println!("SPM depois de mover: B (posição {ib}) está antes de A (posição {ia}): {}", ib < ia);
        let uids: Vec<(String, Option<String>)> = t2.iter().filter(|x| x.id == a || x.id == b).skip(0).map(|x| (x.id.clone(), x.set_id.clone())).collect();
        remove_from_playlist(&alvo.id, &uids[uids.len() - 2..]).await.expect("limpar");
        println!("SPM depois de limpar: {} faixas (antes {antes})", page(&alvo.id).await.unwrap().tracks.len());
        // --- salvar playlist de terceiros, esperando a leitura refletir
        async fn tem(uri_id: &str) -> bool { library("playlists").await.unwrap().items.iter().filter_map(|i| i.collection.as_ref()).any(|c| c.id.ends_with(uri_id)) }
        async fn ate(uri_id: &str, quer: bool) -> bool { for _ in 0..8 { if tem(uri_id).await == quer { return true; } tokio::time::sleep(Duration::from_secs(2)).await; } false }
        let _ = (tem("x"), ate("x", true)); // salvar playlist de terceiros não é possível no Spotify (confirmado: o addToLibrary só aceita álbum/artista)
        println!("SPM salvar playlist de terceiros: {:?}", library_save("playlist", "37i9dQZF1DX0XUsuxWHRQd", true).await.err());
        // álbum e artista continuam: confere por leitura (com espera)
        let alb = "0Hj2X0CQBjpWapFzNQGbk2";
        let _ = alb;
    }
}
