//! Cliente HTTP compartilhado.
//!
//! O proxy (Configurações › Conteúdo › Proxy) é lido do arquivo de configurações **uma vez**, quando o
//! cliente é criado; por isso a interface avisa que é preciso reiniciar o app.

use once_cell::sync::Lazy;
use serde_json::{Map, Value};
use std::time::Duration;

/// User-Agent de navegador usado nas chamadas web (SoundCloud, Deezer).
pub const BROWSER_UA: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

/// Monta a URL do proxy a partir das configurações (`proxyEnabled`, `proxyType`, `proxyUrl`, `proxyAuth`,
/// `proxyUser`, `proxyPass`). Devolve `None` se estiver desligado ou o endereço for inválido.
pub fn proxy_url(values: &Map<String, Value>, secrets: &Map<String, Value>) -> Option<String> {
    let get = |k: &str| values.get(k).or_else(|| secrets.get(k));
    if get("proxyEnabled")?.as_bool() != Some(true) { return None; }
    let addr = get("proxyUrl")?.as_str()?.trim();
    // aceita "host:porta" ou com esquema; o esquema vem do tipo escolhido
    let addr = addr.split_once("://").map(|(_, r)| r).unwrap_or(addr).trim_end_matches('/');
    let (host, port) = addr.rsplit_once(':')?;
    if host.is_empty() || host.contains(['/', '@', ' ']) || port.parse::<u16>().is_err() { return None; }
    let scheme = if get("proxyType").and_then(|v| v.as_str()) == Some("socks") { "socks5h" } else { "http" };
    let auth = if get("proxyAuth").and_then(|v| v.as_bool()) == Some(true) {
        let user = get("proxyUser").and_then(|v| v.as_str()).unwrap_or("");
        let pass = get("proxyPass").and_then(|v| v.as_str()).unwrap_or("");
        if user.is_empty() { String::new() } else { format!("{}:{}@", urlencoding::encode(user), urlencoding::encode(pass)) }
    } else { String::new() };
    Some(format!("{scheme}://{auth}{host}:{port}"))
}

fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(25))
        .pool_idle_timeout(Duration::from_secs(30))
}

pub fn build_client(proxy: Option<&str>) -> reqwest::Client {
    let mut b = builder();
    if let Some(url) = proxy {
        match reqwest::Proxy::all(url) {
            Ok(p) => b = b.proxy(p),
            Err(e) => eprintln!("[proxy] configuração inválida, seguindo sem proxy: {e}"),
        }
    }
    b.build().expect("cliente HTTP")
}

pub static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    let st = crate::settings::current();
    build_client(proxy_url(&st.values, &st.secrets).as_deref())
});

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn m(v: Value) -> Map<String, Value> { v.as_object().unwrap().clone() }

    #[test]
    fn proxy_desligado_ou_invalido_nao_gera_url() {
        assert_eq!(proxy_url(&m(json!({})), &m(json!({}))), None);
        assert_eq!(proxy_url(&m(json!({"proxyEnabled": false, "proxyUrl": "a:1"})), &m(json!({}))), None);
        assert_eq!(proxy_url(&m(json!({"proxyEnabled": true, "proxyUrl": ""})), &m(json!({}))), None);
        assert_eq!(proxy_url(&m(json!({"proxyEnabled": true, "proxyUrl": "semporta"})), &m(json!({}))), None);
        assert_eq!(proxy_url(&m(json!({"proxyEnabled": true, "proxyUrl": "a:99999"})), &m(json!({}))), None);
        assert_eq!(proxy_url(&m(json!({"proxyEnabled": true, "proxyUrl": "a b:80"})), &m(json!({}))), None);
    }

    #[test]
    fn tipos_e_autenticacao() {
        let on = json!({"proxyEnabled": true, "proxyUrl": "proxy.exemplo.com:3128"});
        assert_eq!(proxy_url(&m(on.clone()), &m(json!({}))).unwrap(), "http://proxy.exemplo.com:3128");
        let socks = json!({"proxyEnabled": true, "proxyType": "socks", "proxyUrl": "socks5://10.0.0.1:1080/"});
        assert_eq!(proxy_url(&m(socks), &m(json!({}))).unwrap(), "socks5h://10.0.0.1:1080");
        // a senha vem do arquivo de segredos e é codificada
        let auth = json!({"proxyEnabled": true, "proxyUrl": "h:80", "proxyAuth": true, "proxyUser": "ana@x"});
        assert_eq!(proxy_url(&m(auth.clone()), &m(json!({"proxyPass": "p:w/d"}))).unwrap(), "http://ana%40x:p%3Aw%2Fd@h:80");
        // autenticação desligada ignora usuário e senha
        let noauth = json!({"proxyEnabled": true, "proxyUrl": "h:80", "proxyAuth": false, "proxyUser": "u"});
        assert_eq!(proxy_url(&m(noauth), &m(json!({"proxyPass": "x"}))).unwrap(), "http://h:80");
    }

    /// Sobe um "proxy" local e confere que a requisição passa por ele, com as credenciais.
    #[tokio::test]
    async fn requisicao_passa_pelo_proxy_com_credenciais() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let n = s.read(&mut buf).await.unwrap();
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await.unwrap();
            String::from_utf8_lossy(&buf[..n]).to_string()
        });
        let url = proxy_url(&m(json!({"proxyEnabled": true, "proxyUrl": format!("127.0.0.1:{port}"), "proxyAuth": true, "proxyUser": "ana"})), &m(json!({"proxyPass": "segredo"}))).unwrap();
        let body = build_client(Some(&url)).get("http://alvo.invalido.test/musica").send().await.unwrap().text().await.unwrap();
        assert_eq!(body, "ok");
        let req = seen.await.unwrap();
        assert!(req.starts_with("GET http://alvo.invalido.test/musica"), "o proxy deveria receber a URL completa: {req}");
        // "ana:segredo" em base64
        assert!(req.contains("Basic YW5hOnNlZ3JlZG8="), "faltou a credencial: {req}");
    }
}
