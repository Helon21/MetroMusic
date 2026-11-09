//! Cliente HTTP compartilhado.

use once_cell::sync::Lazy;
use std::time::Duration;

/// User-Agent de navegador usado nas chamadas web (SoundCloud, Deezer).
pub const BROWSER_UA: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

pub static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(25))
        .pool_idle_timeout(Duration::from_secs(30))
        .build()
        .expect("cliente HTTP")
});

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
