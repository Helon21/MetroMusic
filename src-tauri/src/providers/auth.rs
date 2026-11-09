//! Sessão do YouTube Music (cookies do navegador). Com ela a Início, a biblioteca e as curtidas
//! passam a ser as da conta. O cookie fica só neste computador, em arquivo com permissão restrita.

use crate::model::{now_ms, Res};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::PathBuf;

const ORIGIN: &str = "https://music.youtube.com";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Auth {
    pub cookie: String,
    pub sapisid: String,
    #[serde(default)]
    pub data_sync_id: Option<String>,
}

static AUTH: Lazy<RwLock<Option<Auth>>> = Lazy::new(|| RwLock::new(None));
static FILE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

/// Valor de um cookie num cabeçalho `Cookie` ("a=1; b=2").
pub fn cookie_value(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').filter_map(|p| p.trim().split_once('=')).find(|(k, _)| *k == name).map(|(_, v)| v.to_string())
}

/// O SAPISID é o que assina as requisições; o `__Secure-3PAPISID` é equivalente em sessões recentes.
pub fn sapisid_of(cookie: &str) -> Option<String> {
    cookie_value(cookie, "SAPISID").or_else(|| cookie_value(cookie, "__Secure-3PAPISID"))
}

pub fn from_cookie(cookie: &str) -> Res<Auth> {
    let cookie = cookie.trim().trim_start_matches("Cookie:").trim().to_string();
    let sapisid = sapisid_of(&cookie).ok_or("o cookie não tem SAPISID: copie o cabeçalho Cookie completo de music.youtube.com depois de entrar")?;
    Ok(Auth { cookie, sapisid, data_sync_id: None })
}

/// `Authorization: SAPISIDHASH <ts>_<sha1("ts sapisid origin")>`
pub fn sapisid_hash(sapisid: &str, ts: u64) -> String {
    let digest = Sha1::digest(format!("{ts} {sapisid} {ORIGIN}").as_bytes());
    format!("SAPISIDHASH {ts}_{}", digest.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

pub fn get() -> Option<Auth> { AUTH.read().clone() }
pub fn is_logged_in() -> bool { AUTH.read().is_some() }

/// Cabeçalhos que autenticam a requisição, se houver sessão.
pub fn headers() -> Vec<(&'static str, String)> {
    match AUTH.read().as_ref() {
        Some(a) => vec![("Cookie", a.cookie.clone()), ("Authorization", sapisid_hash(&a.sapisid, now_ms() / 1000)), ("X-Goog-AuthUser", "0".into())],
        None => vec![],
    }
}

pub fn on_behalf_of() -> Option<String> { AUTH.read().as_ref().and_then(|a| a.data_sync_id.clone()) }

pub fn init(path: PathBuf) {
    *FILE.write() = Some(path.clone());
    if let Ok(bytes) = std::fs::read(&path) {
        if let Ok(a) = serde_json::from_slice::<Auth>(&bytes) { *AUTH.write() = Some(a); }
    }
}

pub fn set(auth: Auth) -> Res<()> {
    if let Some(path) = FILE.read().clone() {
        if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
        std::fs::write(&path, serde_json::to_vec(&auth).map_err(|e| e.to_string())?).map_err(|e| format!("não foi possível guardar a sessão: {e}"))?;
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)); }
    }
    *AUTH.write() = Some(auth);
    Ok(())
}

pub fn clear() {
    *AUTH.write() = None;
    if let Some(path) = FILE.read().clone() { let _ = std::fs::remove_file(path); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extrai_cookies() {
        let c = "VISITOR_INFO1_LIVE=abc; SAPISID=xyz123/AbC; __Secure-3PSID=q";
        assert_eq!(cookie_value(c, "SAPISID").as_deref(), Some("xyz123/AbC"));
        assert_eq!(sapisid_of("a=1; __Secure-3PAPISID=zzz").as_deref(), Some("zzz"));
        assert!(from_cookie("a=1").is_err());
        assert_eq!(from_cookie("Cookie: SAPISID=k").unwrap().sapisid, "k");
    }
    #[test]
    fn hash_sapisid_conhecido() {
        // sha1("1700000000 abc https://music.youtube.com")
        let h = sapisid_hash("abc", 1_700_000_000);
        assert!(h.starts_with("SAPISIDHASH 1700000000_"));
        assert_eq!(h.len(), "SAPISIDHASH 1700000000_".len() + 40);
    }
}
