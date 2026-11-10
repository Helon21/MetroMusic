//! Tipos compartilhados entre os provedores, o cache e a interface.

use serde::{Deserialize, Serialize};

/// Faixa como a interface a conhece. `provider` + `id` identificam a faixa no serviço de origem.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    /// "youtube", "soundcloud" ou "deezer"
    pub provider: String,
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub isrc: Option<String>,
    #[serde(default)]
    pub artwork_url: Option<String>,
    #[serde(default)]
    pub explicit: bool,
    /// Link público da faixa (SoundCloud, Deezer, YouTube Music).
    #[serde(default)]
    pub url: Option<String>,
    /// Trecho de 30 s oferecido pela API pública do Deezer.
    #[serde(default)]
    pub preview_url: Option<String>,
    /// Ids de navegação do YouTube Music (álbum `MPRE…`, canal do artista `UC…`), para abrir as páginas reais.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
}

impl TrackInfo {
    pub fn artist_line(&self) -> String {
        self.artists.join(", ")
    }
    pub fn key(&self) -> String {
        format!("{}:{}", self.provider, self.id)
    }
}

/// Stream de áudio já resolvido, pronto para baixar.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub url: String,
    /// Cabeçalhos que a CDN espera (o YouTube exige o User-Agent do mesmo cliente que gerou a URL).
    pub headers: Vec<(String, String)>,
    pub mime: String,
    pub codec: String,
    pub bitrate: u32,
    pub content_length: Option<u64>,
    /// "m4a", "mp3", "webm"... usado como extensão do arquivo em cache.
    pub ext: String,
    pub expires_at_ms: u64,
    /// Serviço que realmente fornece os bytes (pode diferir do da faixa, no caso do Deezer).
    pub source: String,
    /// Id da faixa no serviço que fornece os bytes.
    pub source_id: String,
    /// Stream HLS: segmento de inicialização + segmentos, na ordem. Vazio nos demais.
    #[serde(default)]
    pub segments: Vec<String>,
    /// Loudness medido pelo serviço (LUFS), se informado; senão o motor mede enquanto decodifica.
    #[serde(default)]
    pub loudness_lufs: Option<f64>,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub type Res<T> = Result<T, String>;
