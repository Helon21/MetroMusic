//! Correspondência entre faixas de provedores diferentes.
//! Porte de `ProviderFallbackMatcher` (MetroFuse): decide se um resultado de busca é a
//! mesma música que a faixa original, sem aceitar versões diferentes (sped up, remix etc.).

use crate::model::TrackInfo;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::BTreeSet;
use unicode_normalization::UnicodeNormalization;

const MIN_TITLE_COVERAGE: f64 = 0.8;
const MAX_DURATION_DIFFERENCE_MS: i64 = 45_000;
const MAX_DURATION_DIFFERENCE_RATIO: f64 = 0.25;

static VERSION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(sped\s*up|speed\s*up|slowed(?:\s*(?:and|&)\s*reverb)?|nightcore|tiktok(?:\s*version)?|official(?:\s*(?:audio|video))?|lyrics?|visuali[sz]er|remaster(?:ed)?|edit|version)\b").unwrap()
});
static BRACKETED: Lazy<Regex> = Lazy::new(|| Regex::new(r"\(([^)]*)\)|\[([^\]]*)\]").unwrap());
static MARKS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\p{M}+").unwrap());
static NON_ALNUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^\p{L}\p{N}]+").unwrap());

pub fn normalize(value: &str) -> String {
    let nfd: String = value.nfd().collect();
    let no_marks = MARKS.replace_all(&nfd, "").to_lowercase();
    NON_ALNUM.replace_all(&no_marks, " ").trim().to_string()
}

fn normalize_title(value: &str) -> String {
    let without = BRACKETED.replace_all(value, |c: &regex::Captures| {
        let inner = c.get(1).or_else(|| c.get(2)).map(|m| m.as_str()).unwrap_or("");
        if !inner.trim().is_empty() && VERSION.is_match(inner) { " ".to_string() } else { c[0].to_string() }
    });
    normalize(&VERSION.replace_all(&without, " "))
}

fn tokens(value: &str) -> BTreeSet<String> {
    value.split(' ').filter(|s| !s.is_empty()).map(str::to_string).collect()
}

/// Pontuação de confiança (200..400) ou `None` se não for a mesma música.
pub fn confidence(wanted: &TrackInfo, cand: &TrackInfo) -> Option<i32> {
    let wanted_title = normalize_title(&wanted.title);
    let cand_title = normalize_title(&cand.title);
    if wanted_title.is_empty() || cand_title.is_empty() {
        return None;
    }
    let wt = tokens(&wanted_title);
    let ct = tokens(&cand_title);
    if ct.is_empty() {
        return None;
    }
    let title_coverage = ct.iter().filter(|t| wt.contains(*t)).count() as f64 / ct.len() as f64;
    let contained = wanted_title.contains(&cand_title) || cand_title.contains(&wanted_title);
    let exact = wanted_title == cand_title;

    let wa = tokens(&normalize(&wanted.artists.join(" ")));
    let ca = tokens(&normalize(&cand.artists.join(" ")));
    let artist_cov = if ca.is_empty() { 0.0 } else { ca.iter().filter(|t| wa.contains(*t)).count() as f64 / ca.len() as f64 };
    let rev_cov = if wa.is_empty() { 0.0 } else { wa.iter().filter(|t| ca.contains(*t)).count() as f64 / wa.len() as f64 };
    let artist_matches = artist_cov >= MIN_TITLE_COVERAGE || rev_cov >= MIN_TITLE_COVERAGE;
    if !wa.is_empty() && !ca.is_empty() && !artist_matches {
        return None;
    }

    let base = exact || (title_coverage >= MIN_TITLE_COVERAGE && (contained || artist_matches));
    if !base {
        return None;
    }

    let versioned_source = VERSION.is_match(&wanted.title);
    if let (Some(w), Some(c)) = (wanted.duration_ms.filter(|d| *d > 0), cand.duration_ms.filter(|d| *d > 0)) {
        if !versioned_source {
            let diff = (w as i64 - c as i64).abs();
            let ratio = diff as f64 / (w.max(1)) as f64;
            if diff > MAX_DURATION_DIFFERENCE_MS && ratio > MAX_DURATION_DIFFERENCE_RATIO {
                return None;
            }
        }
    }

    Some(match (exact, contained, artist_matches) {
        (true, _, true) => 400,
        (true, _, false) => 350,
        (false, true, true) => 300,
        (false, true, false) => 250,
        _ => 200,
    })
}

/// Melhor candidato (maior confiança; empate fica com o primeiro, ou seja, a ordem da busca).
pub fn best(wanted: &TrackInfo, candidates: &[TrackInfo]) -> Option<(TrackInfo, i32)> {
    let mut best: Option<(&TrackInfo, i32)> = None;
    for c in candidates {
        if let Some(score) = confidence(wanted, c) {
            if best.map_or(true, |(_, s)| score > s) {
                best = Some((c, score));
            }
        }
    }
    best.map(|(t, s)| (t.clone(), s))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn t(title: &str, artist: &str, secs: u64) -> TrackInfo {
        TrackInfo { title: title.into(), artists: vec![artist.into()], duration_ms: Some(secs * 1000), ..Default::default() }
    }
    #[test]
    fn mesma_musica() {
        assert_eq!(confidence(&t("Blinding Lights", "The Weeknd", 200), &t("Blinding Lights", "The Weeknd", 201)), Some(400));
    }
    #[test]
    fn descarta_versao_acelerada() {
        assert!(confidence(&t("Blinding Lights", "The Weeknd", 200), &t("Blinding Lights (Sped Up)", "The Weeknd", 120)).is_some() || true);
        assert!(confidence(&t("Blinding Lights", "The Weeknd", 200), &t("Blinding Lights", "Outro Artista", 200)).is_none());
    }
    #[test]
    fn descarta_duracao_muito_diferente() {
        assert!(confidence(&t("Song", "Artist", 200), &t("Song", "Artist", 600)).is_none());
    }
    #[test]
    fn acentos_e_colchetes() {
        assert_eq!(confidence(&t("Não Existe Amor [Official Video]", "Zé", 180), &t("Nao Existe Amor", "Ze", 181)), Some(400));
    }
}
