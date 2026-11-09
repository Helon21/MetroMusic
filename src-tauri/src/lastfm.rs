//! Last.fm: login (auth.getMobileSession), "Tocando agora", scrobble e Loved. Porte de `LastFM.kt` (MetroFuse).
//!
//! O MetroFuse recebe a chave e o segredo da API por variáveis de build; aqui o usuário cria os dele em
//! https://www.last.fm/api/account/create e informa uma vez no login (ou o app é compilado com
//! `MM_LASTFM_KEY` / `MM_LASTFM_SECRET`). A senha nunca é guardada: só a chave de sessão.

use crate::http::CLIENT;
use crate::model::Res;
use md5::{Digest, Md5};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

const API: &str = "https://ws.audioscrobbler.com/2.0/";

#[derive(Serialize, Deserialize, Clone, Default)]
struct State {
    api_key: String,
    secret: String,
    session_key: Option<String>,
    username: Option<String>,
}

static STATE: Lazy<RwLock<State>> = Lazy::new(|| {
    RwLock::new(State { api_key: option_env!("MM_LASTFM_KEY").unwrap_or("").into(), secret: option_env!("MM_LASTFM_SECRET").unwrap_or("").into(), ..Default::default() })
});
static FILE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status { pub username: Option<String>, pub has_keys: bool }

pub fn status() -> Status {
    let s = STATE.read();
    Status { username: s.session_key.as_ref().and(s.username.clone()), has_keys: !s.api_key.is_empty() && !s.secret.is_empty() }
}

pub fn init(path: PathBuf) {
    *FILE.write() = Some(path.clone());
    if let Ok(bytes) = std::fs::read(&path) {
        if let Ok(saved) = serde_json::from_slice::<State>(&bytes) {
            let mut s = STATE.write();
            if !saved.api_key.is_empty() { s.api_key = saved.api_key; s.secret = saved.secret; }
            s.session_key = saved.session_key;
            s.username = saved.username;
        }
    }
}

fn save() -> Res<()> {
    let Some(path) = FILE.read().clone() else { return Ok(()) };
    if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
    std::fs::write(&path, serde_json::to_vec(&*STATE.read()).map_err(|e| e.to_string())?).map_err(|e| format!("não foi possível guardar a sessão do Last.fm: {e}"))?;
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)); }
    Ok(())
}

/// Assinatura da API: MD5 de `chave+valor` em ordem alfabética das chaves, mais o segredo.
pub fn api_sig(params: &BTreeMap<String, String>, secret: &str) -> String {
    let mut data: String = params.iter().map(|(k, v)| format!("{k}{v}")).collect();
    data.push_str(secret);
    Md5::digest(data.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

async fn call(method: &str, extra: Vec<(String, String)>, with_session: bool) -> Res<Value> {
    let (key, secret, sk) = { let s = STATE.read(); (s.api_key.clone(), s.secret.clone(), s.session_key.clone()) };
    if key.is_empty() || secret.is_empty() { return Err("informe a chave e o segredo da API do Last.fm".into()); }
    let mut p: BTreeMap<String, String> = BTreeMap::new();
    p.insert("method".into(), method.into());
    p.insert("api_key".into(), key);
    if with_session { p.insert("sk".into(), sk.ok_or("entre na sua conta do Last.fm primeiro")?); }
    p.extend(extra);
    let sig = api_sig(&p, &secret);
    p.insert("api_sig".into(), sig);
    p.insert("format".into(), "json".into());
    let resp = CLIENT.post(API).header("User-Agent", "MetroMusic/0.1").form(&p).send().await.map_err(|e| format!("Last.fm: {e}"))?;
    let v: Value = resp.json().await.map_err(|e| format!("Last.fm: resposta inválida ({e})"))?;
    if let Some(code) = v.get("error") {
        return Err(format!("Last.fm ({}): {}", code, v.get("message").and_then(|m| m.as_str()).unwrap_or("erro")));
    }
    Ok(v)
}

/// Entra com usuário e senha. Guarda chave, segredo e sessão; a senha não é guardada.
pub async fn login(api_key: Option<String>, secret: Option<String>, username: &str, password: &str) -> Res<String> {
    {
        let mut s = STATE.write();
        if let Some(k) = api_key.filter(|k| !k.trim().is_empty()) { s.api_key = k.trim().into(); }
        if let Some(k) = secret.filter(|k| !k.trim().is_empty()) { s.secret = k.trim().into(); }
    }
    let v = call("auth.getMobileSession", vec![("username".into(), username.into()), ("password".into(), password.into())], false).await?;
    let sk = v.pointer("/session/key").and_then(|k| k.as_str()).ok_or("o Last.fm não devolveu a sessão")?.to_string();
    let name = v.pointer("/session/name").and_then(|k| k.as_str()).unwrap_or(username).to_string();
    { let mut s = STATE.write(); s.session_key = Some(sk); s.username = Some(name.clone()); }
    save()?;
    Ok(name)
}

pub fn logout() {
    { let mut s = STATE.write(); s.session_key = None; s.username = None; }
    let _ = save();
}

pub async fn now_playing(artist: &str, track: &str, album: Option<&str>, duration: Option<u64>) -> Res<()> {
    let mut e = vec![("artist".to_string(), artist.to_string()), ("track".into(), track.into())];
    if let Some(a) = album.filter(|a| !a.is_empty()) { e.push(("album".into(), a.into())); }
    if let Some(d) = duration { e.push(("duration".into(), d.to_string())); }
    call("track.updateNowPlaying", e, true).await.map(|_| ())
}

pub async fn scrobble(artist: &str, track: &str, timestamp: u64, album: Option<&str>, duration: Option<u64>) -> Res<()> {
    let mut e = vec![("artist[0]".to_string(), artist.to_string()), ("track[0]".into(), track.into()), ("timestamp[0]".into(), timestamp.to_string())];
    if let Some(a) = album.filter(|a| !a.is_empty()) { e.push(("album[0]".into(), a.into())); }
    if let Some(d) = duration { e.push(("duration[0]".into(), d.to_string())); }
    call("track.scrobble", e, true).await.map(|_| ())
}

pub async fn love(artist: &str, track: &str, love: bool) -> Res<()> {
    call(if love { "track.love" } else { "track.unlove" }, vec![("artist".into(), artist.into()), ("track".into(), track.into())], true).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn assinatura_ordena_as_chaves() {
        // exemplo da documentação: md5("api_keyxxxxxxxxxxmethodauth.getSessiontokenyyyyyyyyyyzzzzzzzzzz")
        let mut p = BTreeMap::new();
        p.insert("token".to_string(), "yyyyyyyyyy".to_string());
        p.insert("method".into(), "auth.getSession".into());
        p.insert("api_key".into(), "xxxxxxxxxx".into());
        let expected: String = Md5::digest(b"api_keyxxxxxxxxxxmethodauth.getSessiontokenyyyyyyyyyyzzzzzzzzzz").iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(api_sig(&p, "zzzzzzzzzz"), expected);
    }
}
