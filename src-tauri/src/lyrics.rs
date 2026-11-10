//! Letras sincronizadas. Porte de `LrcLib` e `BetterLyrics`/`TTMLParser` (MetroFuse).
//!
//! - LrcLib: letra por linha (LRC) ou, na falta dela, sem sincronia.
//! - BetterLyrics: TTML com tempo por palavra e vozes de apoio.
//! A ordem vem das configurações; os demais provedores do MetroFuse ainda não foram portados.

use crate::http::{err, CLIENT};
use crate::model::{Res, TrackInfo};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

pub const SUPPORTED: [&str; 4] = ["better", "lrclib", "kugou", "spotify"];
const UA: &str = "MetroMusic/0.1 (player de música desktop)";

#[derive(Serialize, Clone, Debug)]
pub struct Word { pub t: f64, pub end: f64, pub w: String }

#[derive(Serialize, Clone, Debug)]
pub struct Line {
    pub t: f64,
    pub end: f64,
    pub text: String,
    pub words: Vec<Word>,
    pub bg: bool,
    pub agent: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Lyrics { pub synced: bool, pub provider: String, pub lines: Vec<Line> }

static CACHE: Lazy<Mutex<HashMap<String, Option<Lyrics>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Distribui o tempo da linha entre as palavras, proporcional ao tamanho (letra sem tempo por palavra).
fn spread(text: &str, t: f64, end: f64) -> Vec<Word> {
    let ws: Vec<&str> = text.split_whitespace().collect();
    let total: usize = ws.iter().map(|w| w.chars().count() + 1).sum::<usize>().max(1);
    let mut at = t;
    ws.iter().map(|w| {
        let d = (end - t) * (w.chars().count() + 1) as f64 / total as f64;
        let word = Word { t: at, end: at + d, w: w.to_string() };
        at += d;
        word
    }).collect()
}

// ───────── LRC

static LRC_TIME: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]").unwrap());
static LRC_WORD: Lazy<Regex> = Lazy::new(|| Regex::new(r"<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>").unwrap());

/// Lê um arquivo LRC (`[mm:ss.xx] texto`, com várias marcas por linha e tags de palavra opcionais).
pub fn parse_lrc(lrc: &str) -> Vec<Line> {
    let mut raw: Vec<(f64, String)> = vec![];
    for line in lrc.lines() {
        let stamps: Vec<f64> = LRC_TIME.captures_iter(line).map(|c| {
            let frac = c.get(3).map(|f| { let s = f.as_str(); s.parse::<f64>().unwrap_or(0.0) / 10f64.powi(s.len() as i32) }).unwrap_or(0.0);
            c[1].parse::<f64>().unwrap_or(0.0) * 60.0 + c[2].parse::<f64>().unwrap_or(0.0) + frac
        }).collect();
        if stamps.is_empty() { continue; } // metadados ([ar:], [ti:]...)
        let text = LRC_WORD.replace_all(&LRC_TIME.replace_all(line, ""), "").trim().to_string();
        for s in stamps { raw.push((s, text.clone())); }
    }
    raw.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    let n = raw.len();
    (0..n).map(|i| {
        let (t, text) = &raw[i];
        let next = raw.get(i + 1).map(|r| r.0).unwrap_or(t + 5.0);
        // uma linha dura até a próxima, no máximo 7 s (depois disso é pausa instrumental)
        let end = (next - 0.08).clamp(t + 0.6, t + 7.0).max(*t + 0.3);
        Line { t: *t, end, words: spread(text, *t, end), text: text.clone(), bg: false, agent: None }
    }).filter(|l| !l.text.is_empty()).collect()
}

pub fn plain_lines(text: &str) -> Vec<Line> {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).map(|l| Line { t: 0.0, end: 0.0, text: l.to_string(), words: vec![], bg: false, agent: None }).collect()
}

// ───────── LrcLib

static CLEAN: Lazy<Vec<Regex>> = Lazy::new(|| {
    let kw = "official|video|audio|lyrics|lyric|visualizer|hd|hq|4k|remaster|remix|live|acoustic|version|edit|extended|radio|clean|explicit";
    [
        format!(r"(?i)\s*\(.*?({kw}).*?\)"), format!(r"(?i)\s*\[.*?({kw}).*?\]"), r"\s*【.*?】".to_string(), r"\s*\|.*$".to_string(),
        r"(?i)\s*-\s*(official|video|audio|lyrics|lyric|visualizer).*$".to_string(), r"(?i)\s*\(feat\..*?\)".to_string(), r"(?i)\s*\(ft\..*?\)".to_string(),
        r"(?i)\s*feat\..*$".to_string(), r"(?i)\s*ft\..*$".to_string(),
    ].iter().map(|p| Regex::new(p).unwrap()).collect()
});

fn clean_title(t: &str) -> String { CLEAN.iter().fold(t.trim().to_string(), |acc, re| re.replace_all(&acc, "").to_string()).trim().to_string() }

fn clean_artist(a: &str) -> String {
    let a = a.trim();
    for sep in [" & ", " and ", ", ", " x ", " feat. ", " feat ", " ft. ", " ft ", " featuring ", " with "] {
        if let Some(i) = a.to_lowercase().find(sep) { return a[..i].trim().to_string(); }
    }
    a.to_string()
}

#[derive(Clone)]
struct LrcTrack { duration: f64, synced: Option<String>, plain: Option<String> }

async fn lrc_query(params: &[(&str, &str)]) -> Vec<LrcTrack> {
    let Ok(resp) = CLIENT.get("https://lrclib.net/api/search").query(params).header("User-Agent", UA).timeout(Duration::from_secs(12)).send().await else { return vec![] };
    let Ok(list) = resp.json::<Vec<Value>>().await else { return vec![] };
    list.iter().filter_map(|v| {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|x| !x.trim().is_empty()).map(str::to_string);
        let (synced, plain) = (s("syncedLyrics"), s("plainLyrics"));
        if synced.is_none() && plain.is_none() { return None; }
        Some(LrcTrack { duration: v.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.0), synced, plain })
    }).collect()
}

/// As cinco estratégias de busca do MetroFuse, da mais específica à mais ampla.
async fn lrc_search(title: &str, artist: &str, album: Option<&str>) -> Vec<LrcTrack> {
    let (ct, ca) = (clean_title(title), clean_artist(artist));
    let mut attempts: Vec<Vec<(&str, String)>> = vec![];
    let mut a1 = vec![("track_name", ct.clone()), ("artist_name", ca.clone())];
    if let Some(al) = album { a1.push(("album_name", al.to_string())); }
    attempts.push(a1);
    attempts.push(vec![("track_name", ct.clone())]);
    attempts.push(vec![("q", format!("{ca} {ct}"))]);
    attempts.push(vec![("q", ct.clone())]);
    if ct != title.trim() { attempts.push(vec![("track_name", title.trim().to_string()), ("artist_name", artist.trim().to_string())]); }
    for a in attempts {
        let p: Vec<(&str, &str)> = a.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let r = lrc_query(&p).await;
        if !r.is_empty() { return r; }
    }
    vec![]
}

async fn lrclib(t: &TrackInfo) -> Option<Lyrics> {
    let found = lrc_search(&t.title, &t.artist_line(), t.album.as_deref()).await;
    let want = t.duration_ms.map(|d| d as f64 / 1000.0).filter(|d| *d > 0.0);
    // com duração conhecida, aceita até 5 s de diferença; prefere a que tem sincronia
    let mut ok: Vec<&LrcTrack> = found.iter().filter(|c| want.map_or(true, |w| c.duration <= 0.0 || (c.duration - w).abs() <= 5.0)).collect();
    ok.sort_by(|a, b| (b.synced.is_some()).cmp(&a.synced.is_some()).then_with(|| {
        let da = want.map_or(0.0, |w| (a.duration - w).abs()); let db = want.map_or(0.0, |w| (b.duration - w).abs());
        da.partial_cmp(&db).unwrap()
    }));
    let best = ok.first()?;
    if let Some(s) = &best.synced {
        let lines = parse_lrc(s);
        if !lines.is_empty() { return Some(Lyrics { synced: true, provider: "LrcLib".into(), lines }); }
    }
    let lines = plain_lines(best.plain.as_deref()?);
    (!lines.is_empty()).then(|| Lyrics { synced: false, provider: "LrcLib".into(), lines })
}

// ───────── KuGou (LRC por linha, API pública)

/// Remove as linhas de crédito que o KuGou coloca no começo (título, letrista, compositor).
fn drop_credits(lines: Vec<Line>) -> Vec<Line> {
    const MARKS: [&str; 8] = ["作词", "作曲", "编曲", "制作", "Lyrics by", "Composed by", "Written by", "Produced by"];
    lines.into_iter().enumerate().filter(|(i, l)| !(*i < 8 && l.t < 20.0 && (MARKS.iter().any(|m| l.text.contains(m)) || l.text.contains('：') || (*i == 0 && l.text.contains(" - "))))).map(|(_, l)| l).collect()
}

fn decode_kugou(content_b64: &str) -> Option<Vec<Line>> {
    use base64::Engine;
    let raw = base64::engine::general_purpose::STANDARD.decode(content_b64.trim()).ok()?;
    let text = String::from_utf8(raw).ok()?;
    let lines = drop_credits(parse_lrc(text.trim_start_matches('\u{feff}')));
    (!lines.is_empty()).then_some(lines)
}

async fn kugou(t: &TrackInfo) -> Option<Lyrics> {
    let dur = t.duration_ms.unwrap_or(0);
    let keyword = format!("{} - {}", clean_artist(&t.artist_line()), clean_title(&t.title));
    let search: Value = CLIENT.get("https://lyrics.kugou.com/search")
        .query(&[("ver", "1"), ("man", "yes"), ("client", "pc"), ("keyword", keyword.as_str()), ("duration", &dur.to_string())])
        .header("User-Agent", UA).timeout(Duration::from_secs(10)).send().await.ok()?.json().await.ok()?;
    let candidates = search.get("candidates")?.as_array()?;
    // com duração conhecida, aceita até 5 s de diferença
    let pick = candidates.iter().find(|c| dur == 0 || c.get("duration").and_then(|d| d.as_u64()).map_or(true, |d| d == 0 || d.abs_diff(dur) <= 5000))?;
    let (id, key) = (pick.get("id")?.as_str()?, pick.get("accesskey")?.as_str()?);
    let dl: Value = CLIENT.get("https://lyrics.kugou.com/download")
        .query(&[("ver", "1"), ("client", "pc"), ("id", id), ("accesskey", key), ("fmt", "lrc"), ("charset", "utf8")])
        .header("User-Agent", UA).timeout(Duration::from_secs(10)).send().await.ok()?.json().await.ok()?;
    let lines = decode_kugou(dl.get("content")?.as_str()?)?;
    Some(Lyrics { synced: true, provider: "KuGou".into(), lines })
}

// ───────── Spotify (letra do player web; precisa da conta conectada)

async fn spotify(t: &TrackInfo) -> Option<Lyrics> {
    if !crate::settings::current().values.get("spotifyLyrics").and_then(|v| v.as_bool()).unwrap_or(true) { return None; }
    let id = crate::providers::spotify::resolve_id(t).await.ok()??;
    let (synced, text) = crate::providers::spotify::color_lyrics(&id).await.ok()??;
    let lines = if synced { parse_lrc(&text) } else { plain_lines(&text) };
    (!lines.is_empty()).then(|| Lyrics { synced, provider: "Spotify".into(), lines })
}

// ───────── BetterLyrics (TTML)

fn parse_time(s: &str) -> f64 {
    let s = s.trim().trim_end_matches('s');
    let parts: Vec<f64> = s.split(':').map(|p| p.parse::<f64>().unwrap_or(0.0)).collect();
    match parts.as_slice() { [h, m, sec] => h * 3600.0 + m * 60.0 + sec, [m, sec] => m * 60.0 + sec, [sec] => *sec, _ => 0.0 }
}

const NS_META: &str = "http://www.w3.org/ns/ttml#metadata";

fn attr<'a>(n: roxmltree::Node<'a, 'a>, name: &str) -> Option<&'a str> {
    n.attribute((NS_META, name)).or_else(|| n.attribute(name)).filter(|v| !v.is_empty())
}
fn timing<'a>(n: roxmltree::Node<'a, 'a>, name: &str) -> Option<&'a str> {
    n.attribute(name).or_else(|| n.attribute(("http://www.w3.org/ns/ttml#parameter", name))).filter(|v| !v.is_empty())
}

struct Span { text: String, start: f64, end: f64, space: bool }

fn word_span(n: roxmltree::Node, offset: f64, out: &mut Vec<Span>) {
    let (Some(b), Some(e)) = (timing(n, "begin"), timing(n, "end")) else { return };
    let text: String = n.descendants().filter(|d| d.is_text()).filter_map(|d| d.text()).collect();
    let next_space = n.next_sibling().filter(|s| s.is_text()).and_then(|s| s.text()).map_or(false, |t| t.starts_with(char::is_whitespace));
    let space = text.ends_with(char::is_whitespace) || next_space;
    out.push(Span { text, start: parse_time(b) + offset, end: parse_time(e) + offset, space });
}

/// Junta sílabas em palavras: só quebra onde há espaço e a sílaba não termina em hífen.
fn merge(spans: &[Span]) -> Vec<Word> {
    if spans.is_empty() { return vec![]; }
    let mut words = vec![];
    let (mut text, mut start, mut end) = (spans[0].text.clone(), spans[0].start, spans[0].end);
    for i in 1..spans.len() {
        let (prev, cur) = (&spans[i - 1], &spans[i]);
        if prev.space && !prev.text.ends_with('-') {
            words.push(Word { w: text.trim().to_string(), t: start, end });
            text = cur.text.clone(); start = cur.start; end = cur.end;
        } else { text.push_str(&cur.text); end = cur.end; }
    }
    words.push(Word { w: text.trim().to_string(), t: start, end });
    words.into_iter().filter(|w| !w.w.is_empty()).collect()
}

fn line_from(words: Vec<Word>, fallback_text: String, start: f64, p_end: Option<f64>, bg: bool, agent: Option<String>) -> Option<Line> {
    let text = if words.is_empty() { fallback_text.trim().to_string() } else { words.iter().map(|w| w.w.as_str()).collect::<Vec<_>>().join(" ") };
    if text.is_empty() { return None; }
    let end = words.last().map(|w| w.end).or(p_end).unwrap_or(start + 3.0).max(start + 0.2);
    let words = if words.is_empty() { spread(&text, start, end) } else { words };
    Some(Line { t: start, end, text, words, bg, agent })
}

fn parse_p(p: roxmltree::Node, offset: f64, div_agent: Option<&str>, lines: &mut Vec<Line>) {
    let first_span = p.children().filter(|c| c.has_tag_name("span")).filter_map(|c| timing(c, "begin")).map(parse_time).fold(f64::INFINITY, f64::min);
    let begin = match timing(p, "begin") { Some(b) => parse_time(b), None if first_span.is_finite() => first_span, None => return };
    let start = begin + offset;
    let agent = attr(p, "agent").or(div_agent).map(str::to_string);
    let p_bg = attr(p, "role") == Some("x-bg");
    let (mut spans, mut bgs): (Vec<Span>, Vec<Line>) = (vec![], vec![]);
    for c in p.children().filter(|c| c.has_tag_name("span")) {
        match attr(c, "role") {
            Some("x-bg") if !p_bg => {
                // voz de apoio: spans internos (ou o texto direto)
                let mut inner = vec![];
                for s in c.children().filter(|s| s.has_tag_name("span")) { if !matches!(attr(s, "role"), Some("x-translation" | "x-roman")) { word_span(s, offset, &mut inner); } }
                let b_start = timing(c, "begin").map(|b| parse_time(b) + offset).unwrap_or(start);
                let text: String = c.descendants().filter(|d| d.is_text()).filter_map(|d| d.text()).collect();
                if let Some(l) = line_from(merge(&inner), text, b_start, timing(c, "end").map(|e| parse_time(e) + offset), true, None) { bgs.push(l); }
            }
            Some("x-translation" | "x-roman") => {}
            _ => word_span(c, offset, &mut spans),
        }
    }
    let direct: String = p.children().filter(|c| c.is_text()).filter_map(|c| c.text()).collect();
    if let Some(l) = line_from(merge(&spans), direct, start, timing(p, "end").map(|e| parse_time(e) + offset), p_bg, agent) { lines.push(l); }
    lines.extend(bgs);
}

fn walk(n: roxmltree::Node, offset: f64, agent: Option<&str>, lines: &mut Vec<Line>) {
    for c in n.children().filter(|c| c.is_element()) {
        if c.has_tag_name("p") { parse_p(c, offset, agent, lines); }
        else if c.has_tag_name("div") { let a = attr(c, "agent").or(agent); walk(c, offset, a, lines); }
        else { walk(c, offset, agent, lines); }
    }
}

pub fn parse_ttml(ttml: &str) -> Vec<Line> {
    let Ok(doc) = roxmltree::Document::parse(ttml) else { return vec![] };
    let root = doc.root_element();
    let offset = root.descendants().find(|n| n.has_tag_name("audio")).and_then(|a| a.attribute("lyricOffset")).and_then(|o| o.parse::<f64>().ok()).unwrap_or(0.0);
    let mut lines = vec![];
    if let Some(body) = root.children().find(|c| c.has_tag_name("body")) { walk(body, offset, None, &mut lines); }
    lines
}

async fn better(t: &TrackInfo) -> Option<Lyrics> {
    let secs = t.duration_ms.map(|d| (d / 1000).to_string());
    let mut q: Vec<(&str, String)> = vec![("s", t.title.clone()), ("a", t.artist_line())];
    if let Some(d) = secs.filter(|d| d != "0") { q.push(("d", d)); }
    if let Some(a) = t.album.clone().filter(|a| !a.trim().is_empty()) { q.push(("al", a)); }
    let resp = CLIENT.get("https://lyrics-api.boidu.dev/getLyrics").query(&q).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .header("Accept", "application/json").timeout(Duration::from_secs(15)).send().await.ok()?;
    if !resp.status().is_success() { return None; }
    let ttml = resp.json::<Value>().await.ok()?.get("ttml")?.as_str()?.trim().to_string();
    let lines = parse_ttml(&ttml);
    (!lines.is_empty()).then(|| Lyrics { synced: true, provider: "BetterLyrics".into(), lines })
}

/// Busca a letra nos provedores de `order` (na ordem). `None` = ninguém tem.
pub async fn get(track: &TrackInfo, order: &[String]) -> Res<Option<Lyrics>> {
    let key = format!("{}|{}", track.key(), order.join(","));
    if let Some(hit) = CACHE.lock().get(&key) { return Ok(hit.clone()); }
    let mut found = None;
    let embedded_on = crate::settings::current().values.get("readEmbeddedLyrics").and_then(|v| v.as_bool()).unwrap_or(true);
    if track.provider == "local" && embedded_on { found = crate::local::lyrics(std::path::Path::new(&track.id)); }
    for p in order {
        if found.is_some() { break; }
        let r = match p.as_str() { "better" => better(track).await, "lrclib" => lrclib(track).await, "kugou" => kugou(track).await, "spotify" => spotify(track).await, _ => None };
        if r.is_some() { found = r; break; }
    }
    CACHE.lock().insert(key, found.clone());
    Ok(found)
}

#[allow(dead_code)]
fn _unused(_: impl std::fmt::Display) -> String { err("") }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lrc_basico() {
        let l = parse_lrc("[ar:X]\n[00:12.50] Primeira linha\n[00:15.00]Segunda <00:15.50>linha\n[01:02.3][01:30.00] refrão\n");
        assert_eq!(l.len(), 4);
        assert_eq!(l[0].t, 12.5);
        assert_eq!(l[1].text, "Segunda linha");
        assert_eq!(l[2].t, 62.3);
        assert!(l[0].end > l[0].t && l[0].end <= 12.5 + 7.0);
        assert_eq!(l[0].words.len(), 2);
    }
    #[test]
    fn ttml_palavras_e_apoio() {
        let ttml = r#"<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div ttm:agent="v1">
          <p begin="0:10.000" end="0:14.000"><span begin="0:10.000" end="0:10.500">Hel</span><span begin="0:10.500" end="0:11.000">lo </span><span begin="0:11.000" end="0:12.000">world</span>
          <span ttm:role="x-bg"><span begin="0:12.000" end="0:13.000">(ooh)</span></span></p>
          <p begin="0:15.000" end="0:17.000"><span begin="0:15.000" end="0:16.000">Next </span><span begin="0:16.000" end="0:17.000">one</span></p></div></body></tt>"#;
        let l = parse_ttml(ttml);
        assert_eq!(l.len(), 3);
        assert_eq!(l[0].text, "Hello world");
        assert_eq!(l[0].words.len(), 2);
        assert_eq!(l[0].words[0].w, "Hello");
        assert!(l[1].bg && l[1].text == "(ooh)");
        assert_eq!(l[2].t, 15.0);
        assert_eq!(l[0].agent.as_deref(), Some("v1"));
    }
    #[test]
    fn kugou_decodifica_e_tira_creditos() {
        use base64::Engine;
        let lrc = "[ti:X]\r\n[00:00.00]Blinding Lights - The Weeknd\r\n[00:01.75]Lyrics by：A\r\n[00:10.00]Yeah\r\n[00:14.50]I\'ve been tryna call\r\n";
        let b64 = base64::engine::general_purpose::STANDARD.encode(lrc.as_bytes());
        let lines = super::decode_kugou(&b64).unwrap();
        assert_eq!(lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), vec!["Yeah", "I've been tryna call"]);
        assert!(super::decode_kugou("não é base64!!").is_none());
    }

    #[test]
    fn limpa_titulo_e_artista() {
        assert_eq!(clean_title("Song (Official Video) [HD]"), "Song");
        assert_eq!(clean_title("Song (feat. X)"), "Song");
        assert_eq!(clean_artist("Daft Punk, Pharrell"), "Daft Punk");
    }
}
