//! Saúde dos provedores: bate num endereço leve de cada serviço e mede o tempo de resposta.
//! Nenhuma música é baixada. Serviços sem suporte (áudio protegido) aparecem como `unavailable`.

use crate::http::CLIENT;
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub id: String,
    /// `online` (respondeu bem) · `reachable` (respondeu, mas recusou: 3xx/4xx) · `offline` (sem resposta) · `unavailable` (sem suporte)
    pub status: String,
    pub ms: u64,
    pub detail: String,
}

/// Endereços leves que provam que o serviço está respondendo.
const TARGETS: [(&str, &str, &str); 4] = [
    ("youtube", "https://music.youtube.com/", "InnerTube"),
    ("soundcloud", "https://soundcloud.com/", "Site e HLS"),
    ("deezer", "https://api.deezer.com/infos", "API pública"),
    ("jiosaavn", "https://www.jiosaavn.com/", "API pública"),
];
const UNSUPPORTED: [&str; 2] = ["tidal", "qobuz"];

pub fn classify(status: Option<u16>) -> &'static str {
    match status { Some(200..=299) => "online", Some(_) => "reachable", None => "offline" }
}

pub async fn probe(id: &str, url: &str, detail: &str, timeout: Duration) -> Health {
    let t0 = Instant::now();
    let res = CLIENT.get(url).timeout(timeout).header("User-Agent", crate::http::BROWSER_UA).send().await;
    let ms = t0.elapsed().as_millis() as u64;
    match res {
        Ok(r) => { let s = r.status().as_u16(); Health { id: id.into(), status: classify(Some(s)).into(), ms, detail: format!("{detail} · HTTP {s}") } }
        Err(e) => Health { id: id.into(), status: "offline".into(), ms, detail: if e.is_timeout() { "tempo esgotado".into() } else { "sem resposta".into() } },
    }
}

pub async fn check_all() -> Vec<Health> {
    let mut out = futures_util::future::join_all(TARGETS.iter().map(|(id, url, d)| probe(id, url, d, Duration::from_secs(6)))).await;
    out.extend(UNSUPPORTED.iter().map(|id| Health { id: (*id).into(), status: "unavailable".into(), ms: 0, detail: "áudio protegido".into() }));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn classificacao() {
        assert_eq!(classify(Some(200)), "online");
        assert_eq!(classify(Some(204)), "online");
        assert_eq!(classify(Some(403)), "reachable");
        assert_eq!(classify(Some(301)), "reachable");
        assert_eq!(classify(Some(503)), "reachable");
        assert_eq!(classify(None), "offline");
    }

    async fn server(status_line: &'static str) -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = l.accept().await else { break };
                let mut b = [0u8; 1024]; let _ = s.read(&mut b).await;
                let _ = s.write_all(format!("HTTP/1.1 {status_line}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await;
            }
        });
        format!("http://{addr}/")
    }

    #[tokio::test]
    async fn mede_servidor_ok_recusado_e_fora_do_ar() {
        let ok = probe("x", &server("200 OK").await, "teste", Duration::from_secs(3)).await;
        assert_eq!(ok.status, "online");
        let bloqueado = probe("x", &server("403 Forbidden").await, "teste", Duration::from_secs(3)).await;
        assert_eq!((bloqueado.status.as_str(), bloqueado.detail.contains("403")), ("reachable", true));
        // porta fechada: ninguém escutando
        let fora = probe("x", "http://127.0.0.1:1/", "teste", Duration::from_secs(3)).await;
        assert_eq!(fora.status, "offline");
    }
}
