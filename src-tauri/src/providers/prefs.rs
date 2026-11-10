//! Preferências de conteúdo que mudam as requisições ao YouTube Music: idioma (`hl`), país (`gl`) e
//! se a sessão da conta é usada ao navegar (Início, Explorar, páginas). A interface envia os valores
//! com `content_prefs_set` ao abrir o app e a cada mudança.

use once_cell::sync::Lazy;
use parking_lot::RwLock;

#[derive(Clone, Debug, PartialEq)]
pub struct Prefs { pub hl: String, pub gl: String, pub login_for_browse: bool }

static PREFS: Lazy<RwLock<Prefs>> = Lazy::new(|| RwLock::new(Prefs { hl: "en".into(), gl: "US".into(), login_for_browse: true }));

static QUALITY: Lazy<RwLock<String>> = Lazy::new(|| RwLock::new("max".into()));
/// Qualidade do áudio (`auto` · `low` · `high` · `max`); valor desconhecido vira `max`.
pub fn quality() -> String { QUALITY.read().clone() }
pub fn set_quality(q: &str) { *QUALITY.write() = match q { "auto" | "low" | "high" | "max" => q.to_string(), _ => "max".into() }; }

static SC_QUALITY: Lazy<RwLock<String>> = Lazy::new(|| RwLock::new("aac160".into()));
/// Qualidade do SoundCloud (`mp3` · `aac96` · `aac160`); valor desconhecido vira `aac160`.
pub fn sc_quality() -> String { SC_QUALITY.read().clone() }
/// Devolve `true` se o valor mudou.
pub fn set_sc_quality(q: &str) -> bool {
    let n = match q { "mp3" | "aac96" | "aac160" => q.to_string(), _ => "aac160".into() };
    let mut g = SC_QUALITY.write();
    let changed = *g != n; *g = n; changed
}

static JIO: Lazy<RwLock<(String, String)>> = Lazy::new(|| RwLock::new(("320".into(), "english".into())));
/// Qualidade do JioSaavn em kbps (`320` · `160` · `96` · `48`).
pub fn jio_quality() -> String { JIO.read().0.clone() }
/// Idioma do início do JioSaavn (letras minúsculas, ex.: `hindi`).
pub fn jio_language() -> String { JIO.read().1.clone() }
/// Devolve `true` se a qualidade mudou.
pub fn set_jio(quality: &str, language: &str) -> bool {
    let q = match quality { "160" | "96" | "48" => quality, _ => "320" }.to_string();
    let ok = !language.is_empty() && language.len() <= 20 && language.chars().all(|c| c.is_ascii_lowercase());
    let mut g = JIO.write();
    let changed = g.0 != q;
    g.0 = q;
    if ok { g.1 = language.to_string(); }
    changed
}

pub fn get() -> Prefs { PREFS.read().clone() }
pub fn hl() -> String { PREFS.read().hl.clone() }
pub fn gl() -> String { PREFS.read().gl.clone() }
pub fn login_for_browse() -> bool { PREFS.read().login_for_browse }

/// Aceita só códigos no formato esperado (`pt`, `pt-BR`, `BR`); qualquer outra coisa mantém o valor atual.
fn clean(s: &str, current: &str, upper: bool) -> String {
    let ok = !s.is_empty() && s.len() <= 8 && s.chars().all(|c| c.is_ascii_alphabetic() || c == '-');
    if !ok { return current.to_string(); }
    if upper { s.to_ascii_uppercase() } else { s.to_string() }
}

pub fn set(hl: &str, gl: &str, login_for_browse: bool) {
    let mut p = PREFS.write();
    p.hl = clean(hl, &p.hl, false);
    p.gl = clean(gl, &p.gl, true);
    p.login_for_browse = login_for_browse;
}

/// Valor do cabeçalho `Accept-Language` para o idioma atual.
pub fn accept_language() -> String {
    let hl = hl();
    if hl.eq_ignore_ascii_case("en") || hl.starts_with("en-") { format!("{hl},en;q=0.9") } else { format!("{hl},{},en;q=0.8", hl.split('-').next().unwrap_or("en")) }
}

#[cfg(test)]
mod tests {
    use super::*;

    // um teste só: as preferências são globais e testes em paralelo se atropelariam
    #[test]
    fn preferencias() {
        set("pt-BR", "br", false);
        assert_eq!(get(), Prefs { hl: "pt-BR".into(), gl: "BR".into(), login_for_browse: false });
        set("../etc", "", true); // inválidos: mantém os anteriores
        assert_eq!(get(), Prefs { hl: "pt-BR".into(), gl: "BR".into(), login_for_browse: true });
        assert_eq!(accept_language(), "pt-BR,pt,en;q=0.8");
        set("en", "US", true);
        assert_eq!(accept_language(), "en,en;q=0.9");
        set_quality("low"); assert_eq!(quality(), "low");
        set_quality("lixo"); assert_eq!(quality(), "max");
        assert!(set_sc_quality("mp3")); assert!(!set_sc_quality("mp3")); assert_eq!(sc_quality(), "mp3");
        set_sc_quality("lixo"); assert_eq!(sc_quality(), "aac160");
        assert!(set_jio("96", "hindi")); assert!(!set_jio("96", "../x")); assert_eq!((jio_quality().as_str(), jio_language().as_str()), ("96", "hindi"));
        set_jio("lixo", "english"); assert_eq!(jio_quality(), "320");
    }
}
