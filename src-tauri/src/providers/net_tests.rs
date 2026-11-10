//! Testes que falam com os serviços reais. Rodam com:
//!   cargo test net_ -- --ignored --nocapture --test-threads=1
use super::*;
use crate::http::CLIENT;

/// Baixa o primeiro MiB do stream com os cabeçalhos resolvidos e mede a velocidade.
async fn probe_download(s: &StreamInfo) -> (u16, usize, f64, Option<String>) {
    let t0 = std::time::Instant::now();
    let mut req = CLIENT.get(&s.url).header("Range", "bytes=0-1048575");
    for (k, v) in &s.headers { req = req.header(k.as_str(), v.as_str()); }
    let resp = req.send().await.expect("download");
    let status = resp.status().as_u16();
    let range = resp.headers().get("content-range").and_then(|v| v.to_str().ok()).map(str::to_string);
    let bytes = resp.bytes().await.expect("corpo");
    (status, bytes.len(), bytes.len() as f64 / 1024.0 / t0.elapsed().as_secs_f64(), range)
}

#[tokio::test]
#[ignore]
async fn net_soundcloud() {
    let r = soundcloud::search("daft punk one more time", 8).await.expect("busca");
    assert!(!r.is_empty(), "sem resultados");
    for t in r.iter().take(3) { println!("SC  {} | {} | {} | {:?}ms", t.id, t.title, t.artist_line(), t.duration_ms); }
    let s = soundcloud::resolve(&r[0]).await.expect("resolve");
    println!("SC stream: {} {} {}bps, {} segmentos", s.mime, s.codec, s.bitrate, s.segments.len());
    let path = "/tmp/claude-1000/-home-caduhd4-Builds-brave-Discord2-MetroMusic/9ebec6a4-5f5d-4cf5-a251-ff0d660f0be5/scratchpad/sc.m4a";
    let mut data: Vec<u8> = vec![];
    if s.segments.is_empty() {
        let (st, n, kbs, _) = probe_download(&s).await;
        println!("SC progressivo: HTTP {st}, {n} bytes, {kbs:.0} KiB/s");
        return;
    }
    let t0 = std::time::Instant::now();
    for u in &s.segments {
        let mut req = CLIENT.get(u);
        for (k, v) in &s.headers { req = req.header(k.as_str(), v.as_str()); }
        let resp = req.send().await.expect("segmento");
        assert!(resp.status().is_success(), "segmento HTTP {}", resp.status());
        data.extend_from_slice(&resp.bytes().await.expect("corpo"));
    }
    std::fs::write(path, &data).unwrap();
    println!("SC baixado: {} bytes em {:.1}s", data.len(), t0.elapsed().as_secs_f64());
    println!("SC decodificação: {:?}", decode_stats(path, "m4a"));
}

#[tokio::test]
#[ignore]
async fn net_youtube() {
    let r = youtube::search("blinding lights the weeknd", 8).await.expect("busca");
    assert!(!r.is_empty(), "sem resultados");
    for t in r.iter().take(4) { println!("YT  {} | {} | {} | {:?} | {:?}ms", t.id, t.title, t.artist_line(), t.album, t.duration_ms); }
    let s = youtube::resolve(&r[0].id, r[0].duration_ms).await.expect("resolve");
    let ua = s.headers.iter().find(|(k, _)| k == "User-Agent").map(|(_, v)| v.clone()).unwrap_or_default();
    let (st, n, kbs, range) = probe_download(&s).await;
    println!("YT stream: {} {} {}bps len={:?}  UA={}", s.mime, s.codec, s.bitrate, s.content_length, &ua[..ua.len().min(48)]);
    println!("YT download: HTTP {st}, {n} bytes, {kbs:.0} KiB/s, {range:?}");
    assert!(st == 206 || st == 200);
    assert!(n > 100_000);
}

#[tokio::test]
#[ignore]
async fn net_deezer_e_correspondencia() {
    let r = deezer::search("blinding lights the weeknd", 5).await.expect("busca");
    assert!(!r.is_empty());
    for t in r.iter().take(3) { println!("DZ  {} | {} | {} | preview={}", t.id, t.title, t.artist_line(), t.preview_url.is_some()); }
    let order = vec!["youtube".to_string(), "soundcloud".to_string()];
    let m = find_match(&r[0], &order).await;
    println!("correspondência do Deezer -> {:?}", m.as_ref().map(|t| (t.provider.clone(), t.id.clone(), t.title.clone())));
    assert!(m.is_some(), "o Deezer deveria achar a mesma música em outro provedor");
    let s = resolve(&r[0], &order).await.expect("resolve via correspondência");
    println!("Deezer tocará via: {} ({})", s.source, s.codec);
    assert!(s.source == "youtube" || s.source == "soundcloud");
}

/// Baixa o stream inteiro (em blocos com Range) para um arquivo.
async fn download_all(s: &StreamInfo, path: &str) -> usize {
    let mut data: Vec<u8> = vec![];
    let total = s.content_length.expect("content_length") as usize;
    while data.len() < total {
        let end = (data.len() + 1_048_576).min(total) - 1;
        let mut req = CLIENT.get(&s.url).header("Range", format!("bytes={}-{}", data.len(), end));
        for (k, v) in &s.headers { req = req.header(k.as_str(), v.as_str()); }
        data.extend_from_slice(&req.send().await.expect("bloco").bytes().await.expect("corpo"));
    }
    std::fs::write(path, &data).unwrap();
    data.len()
}

fn decode_stats(path: &str, ext: &str) -> Result<String, String> {
    use symphonia::core::{codecs::DecoderOptions, formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint};
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(ext);
    let probed = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()).map_err(|e| format!("probe: {e}"))?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("sem faixa de áudio")?.clone();
    let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default()).map_err(|e| format!("decoder: {e}"))?;
    let (mut frames, mut packets) = (0usize, 0usize);
    loop {
        match format.next_packet() {
            Ok(p) => { if p.track_id() != track.id { continue; } packets += 1; if let Ok(buf) = decoder.decode(&p) { frames += buf.frames(); } }
            Err(symphonia::core::errors::Error::IoError(_)) => break,
            Err(e) => return Err(format!("next_packet após {packets} pacotes: {e}")),
        }
    }
    let rate = track.codec_params.sample_rate.unwrap_or(0);
    Ok(format!("{} pacotes, {} quadros, {:.1}s a {} Hz, {:?} canais", packets, frames, frames as f64 / rate.max(1) as f64, rate, track.codec_params.channels))
}

#[tokio::test]
#[ignore]
async fn net_decode_youtube() {
    let r = youtube::search("blinding lights the weeknd", 3).await.unwrap();
    let s = youtube::resolve(&r[0].id, r[0].duration_ms).await.unwrap();
    let path = "/tmp/claude-1000/-home-caduhd4-Builds-brave-Discord2-MetroMusic/9ebec6a4-5f5d-4cf5-a251-ff0d660f0be5/scratchpad/yt.m4a";
    let n = download_all(&s, path).await;
    println!("YT baixado: {n} bytes");
    println!("YT decodificação: {:?}", decode_stats(path, "m4a"));
}

#[tokio::test]
#[ignore]
async fn net_ytmusic_inicio_e_paginas() {
    let mut home = ytmusic::home(None, None).await.expect("início");
    println!("INICIO: {} chips, {} seções na 1ª página, continuação={}", home.chips.len(), home.sections.len(), home.continuation.is_some());
    println!("INICIO chips: {:?}", home.chips.iter().map(|c| c.title.as_str()).collect::<Vec<_>>());
    // segue as continuações (a Início carrega aos poucos)
    let mut pages = 0;
    while let (Some(c), true) = (home.continuation.clone(), pages < 4) {
        let more = ytmusic::home(None, Some(c)).await.expect("continuação");
        pages += 1;
        println!("INICIO continuação {pages}: +{} seções", more.sections.len());
        home.sections.extend(more.sections);
        home.continuation = more.continuation;
    }
    let (mut tracks, mut albums, mut playlists, mut artists, mut mixes) = (0, 0, 0, 0, 0);
    for s in &home.sections {
        println!("INICIO  [{}] {} ({} itens) mais={:?}", s.layout, s.title, s.items.len(), s.more);
        for i in &s.items {
            match (&i.track, &i.collection) { (Some(_), _) => tracks += 1, (_, Some(c)) => match c.kind.as_str() { "album" => albums += 1, "playlist" => playlists += 1, "artist" => artists += 1, _ => mixes += 1 }, _ => {} }
        }
    }
    println!("INICIO totais: {tracks} músicas, {albums} álbuns, {playlists} playlists, {artists} artistas, {mixes} mixes");
    assert!(home.sections.len() >= 4, "a Início deveria ter várias seções");
    let first = |kind: &str| home.sections.iter().flat_map(|s| s.items.iter()).filter_map(|i| i.collection.as_ref()).find(|c| c.kind == kind).cloned();
    for kind in ["album", "playlist", "artist"] {
        let Some(c) = first(kind) else { println!("PAGINA {kind}: nenhum na Início"); continue };
        let p = ytmusic::page(&c.id).await.unwrap_or_else(|e| panic!("página {kind} {}: {e}", c.id));
        println!("PAGINA {kind} {} -> \"{}\" | {} | {} músicas, {} seções, {} itens | arte={}", c.id, p.title, p.subtitle, p.tracks.len(), p.sections.len(), p.items.len(), p.artwork.is_some());
        for t in p.tracks.iter().take(3) { println!("PAGINA    {} — {} [{}] {:?}ms album={:?}", t.title, t.artist_line(), t.id, t.duration_ms, t.album); }
        if kind != "artist" { assert!(!p.tracks.is_empty(), "{kind} sem músicas"); }
    }
    // álbum e artista conhecidos, para não depender do que a Início mostrar hoje
    let al = ytmusic::page("MPREb_9nqEki4ZDpp").await;
    println!("PAGINA álbum fixo: {:?}", al.as_ref().map(|p| (p.title.clone(), p.tracks.len())).map_err(|e| e.clone()));
    let ar = ytmusic::page("UCtxdfwb9wfkoGocVUAJ-Bmg").await;
    println!("PAGINA artista fixo: {:?}", ar.as_ref().map(|p| (p.title.clone(), p.tracks.len(), p.sections.len())).map_err(|e| e.clone()));
    let r = ytmusic::radio(Some("J7p4bzqLvCw"), None).await.expect("rádio");
    println!("RADIO: {} músicas, 1ª: {} — {}", r.len(), r[0].title, r[0].artist_line());
    assert!(r.len() > 5);
    // grava dados reais como fixtures para conferir a interface fora do app
    let dir = "/tmp/claude-1000/-home-caduhd4-Builds-brave-Discord2-MetroMusic/9ebec6a4-5f5d-4cf5-a251-ff0d660f0be5/scratchpad/fixtures";
    let _ = std::fs::create_dir_all(dir);
    std::fs::write(format!("{dir}/home.json"), serde_json::to_string(&home).unwrap()).unwrap();
    if let Ok(p) = &al { std::fs::write(format!("{dir}/album.json"), serde_json::to_string(p).unwrap()).unwrap(); }
    if let Ok(p) = &ar { std::fs::write(format!("{dir}/artist.json"), serde_json::to_string(p).unwrap()).unwrap(); }
    std::fs::write(format!("{dir}/radio.json"), serde_json::to_string(&r).unwrap()).unwrap();
}

#[tokio::test]
#[ignore]
async fn net_letras() {
    let t = TrackInfo { provider: "youtube".into(), id: "J7p4bzqLvCw".into(), title: "Blinding Lights".into(), artists: vec!["The Weeknd".into()], album: Some("After Hours".into()), duration_ms: Some(202_000), ..Default::default() };
    for p in ["better", "lrclib"] {
        let l = crate::lyrics::get(&t, &[p.to_string()]).await.unwrap();
        match l {
            Some(l) => println!("LETRA {p}: {} | sincronizada={} | {} linhas | 1ª: {:?} | palavras da 1ª: {} | bg={}", l.provider, l.synced, l.lines.len(), l.lines[0].text, l.lines[0].words.len(), l.lines.iter().filter(|x| x.bg).count()),
            None => println!("LETRA {p}: não encontrada"),
        }
    }
    let ordem = vec!["better".to_string(), "lrclib".to_string()];
    let todos = crate::lyrics::get(&t, &ordem).await.unwrap();
    assert!(todos.is_some(), "nenhum provedor achou a letra");
    let raro = TrackInfo { provider: "youtube".into(), id: "x".into(), title: "zzzxqj faixa inexistente 91827".into(), artists: vec!["ninguem".into()], ..Default::default() };
    println!("LETRA inexistente: {:?}", crate::lyrics::get(&raro, &ordem).await.unwrap().is_some());
}

#[tokio::test]
#[ignore]
async fn net_conta_curtidas() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let info = super::ytmusic::account_info().await;
    println!("CONTA: {:?}", info.as_ref().map(|i| i.name.clone()));
    let p = super::ytmusic::library("songs").await.unwrap();
    println!("CURTIDAS: {} faixas", p.tracks.len());
}

fn paths(v: &serde_json::Value, key: &str, here: String, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(m) => for (k, x) in m { let p = format!("{here}.{k}"); if k == key { out.push(format!("{p} => {}", x.to_string().chars().take(160).collect::<String>())); } paths(x, key, p, out); },
        serde_json::Value::Array(a) => for (i, x) in a.iter().enumerate() { paths(x, key, format!("{here}[{i}]"), out); },
        _ => {}
    }
}

#[tokio::test]
#[ignore]
async fn net_conta_debug() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let v = super::ytmusic::debug_raw("FEmusic_liked_videos").await;
    for key in ["continuations", "continuationItemRenderer", "nextContinuationData"] {
        let mut o = vec![]; paths(&v, key, String::new(), &mut o);
        println!("DBG {key}: {} achados", o.len()); for l in o.iter().take(4) { println!("DBG   {l}"); }
    }
    let mut o = vec![]; paths(&v, "musicShelfRenderer", String::new(), &mut o); println!("DBG shelves: {}", o.len());
    let mut o = vec![]; paths(&v, "musicPlaylistShelfRenderer", String::new(), &mut o); println!("DBG plshelves: {}", o.len());
}

#[tokio::test]
#[ignore]
async fn net_conta_debug2() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let v = super::ytmusic::debug_raw("FEmusic_liked_videos").await;
    let tok = v.pointer("/contents/singleColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/musicShelfRenderer/continuations/0/nextContinuationData/continuation").and_then(|t| t.as_str()).unwrap().to_string();
    let c = super::ytmusic::debug_raw_cont(&tok).await;
    let sc = &c["continuationContents"]["musicShelfContinuation"];
    println!("DBG2 shelf keys: {:?}", sc.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()));
    println!("DBG2 contents len: {:?} first: {}", sc["contents"].as_array().map(|a| a.len()), sc["contents"][0].to_string().chars().take(300).collect::<String>());
    println!("DBG2 chaves: {:?}", c.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()));
    for key in ["musicShelfContinuation", "appendContinuationItemsAction", "musicPlaylistShelfContinuation", "musicResponsiveListItemRenderer", "continuationItemRenderer"] {
        let mut o = vec![]; paths(&c, key, String::new(), &mut o);
        println!("DBG2 {key}: {} achados {:?}", o.len(), o.first().map(|x| x.chars().take(140).collect::<String>()));
    }
}

#[tokio::test]
#[ignore]
async fn net_conta_vllm() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    for id in ["VLLM", "FEmusic_liked_videos"] {
        let p = super::ytmusic::page(id).await;
        println!("VLLM {id}: {:?}", p.map(|p| p.tracks.len()));
    }
}

#[tokio::test]
#[ignore]
async fn net_conta_tudo() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let t = std::time::Instant::now();
    let songs = super::ytmusic::library("songs").await.unwrap();
    println!("TUDO curtidas: {} em {:?}", songs.tracks.len(), t.elapsed());
    let h = super::ytmusic::library("history").await.unwrap();
    println!("TUDO histórico: {} dias, {} faixas, 1º dia: {:?}", h.sections.len(), h.sections.iter().map(|s| s.items.len()).sum::<usize>(), h.sections.first().map(|s| s.title.clone()));
    for k in ["playlists", "albums", "artists"] { let p = super::ytmusic::library(k).await.unwrap(); println!("TUDO {k}: {} itens", p.items.len()); }
}

#[tokio::test]
#[ignore]
async fn net_conta_fim() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let v = super::ytmusic::debug_raw("VLLM").await;
    let mut o = vec![]; paths(&v, "continuationCommand", String::new(), &mut o);
    println!("FIM 1ª: {} tokens; contagem na página: {:?}", o.len(), v.pointer("/header/musicEditablePlaylistDetailHeaderRenderer/subtitle").or_else(|| v.pointer("/header/musicDetailHeaderRenderer/secondSubtitle")).map(|x| x.to_string().chars().take(200).collect::<String>()));
    let mut o2 = vec![]; paths(&v, "secondSubtitle", String::new(), &mut o2); paths(&v, "subtitle", String::new(), &mut o2);
    for l in o2.iter().take(3) { println!("FIM sub: {l}"); }
}

#[tokio::test]
#[ignore]
async fn net_conta_fim2() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let v = super::ytmusic::debug_raw("VLLM").await;
    let tok = |v: &serde_json::Value| { let mut o = vec![]; fn walk(v: &serde_json::Value, o: &mut Vec<String>) { match v { serde_json::Value::Object(m) => { if let Some(t) = m.get("continuationCommand").and_then(|c| c.get("token")).and_then(|t| t.as_str()) { o.push(t.to_string()); } m.values().for_each(|x| walk(x, o)); } serde_json::Value::Array(a) => a.iter().for_each(|x| walk(x, o)), _ => {} } } walk(v, &mut o); o };
    let mut t = tok(&v);
    for i in 0..30 {
        let Some(token) = t.last().cloned() else { println!("FIM2 sem token na parte {i}"); break };
        let c = super::ytmusic::debug_raw_cont(&token).await;
        let mut rows = vec![]; paths(&c, "musicResponsiveListItemRenderer", String::new(), &mut rows);
        t = tok(&c);
        let keys: Vec<String> = c.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
        println!("FIM2 parte {i}: {} linhas, {} tokens, chaves {:?}", rows.len(), t.len(), keys);
    }
}

#[tokio::test]
#[ignore]
async fn net_conta_ids() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let p = super::ytmusic::library("songs").await.unwrap();
    let com_album = p.tracks.iter().filter(|t| t.album_id.is_some()).count();
    let com_artista = p.tracks.iter().filter(|t| t.artist_id.is_some()).count();
    println!("IDS nome sem id: {}", p.tracks.iter().filter(|t| t.album.is_some() && t.album_id.is_none()).count());
    println!("IDS {} faixas: {com_album} com álbum, {com_artista} com artista; 1ª: {:?} {:?}", p.tracks.len(), p.tracks[0].album_id, p.tracks[0].artist_id);
    let alb = p.tracks.iter().find_map(|t| t.album_id.clone()).unwrap();
    let pg = super::ytmusic::page(&alb).await.unwrap();
    println!("IDS álbum {alb}: {:?} com {} faixas", pg.title, pg.tracks.len());
}

#[tokio::test]
#[ignore]
async fn net_conta_recap() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    fn grep(v: &serde_json::Value, here: String, out: &mut Vec<String>) {
        match v {
            serde_json::Value::String(s) => { let l = s.to_lowercase(); if l.contains("recap") || l.contains("replay") || l.contains("wrapped") { out.push(format!("{here} = {}", s.chars().take(100).collect::<String>())); } }
            serde_json::Value::Object(m) => for (k, x) in m { grep(x, format!("{here}.{k}"), out); },
            serde_json::Value::Array(a) => for (i, x) in a.iter().enumerate() { grep(x, format!("{here}[{i}]"), out); },
            _ => {}
        }
    }
    for id in ["FEmusic_home", "FEmusic_explore", "FEmusic_recap", "FEmusic_replay", "FEmusic_library_landing"] {
        let r = super::ytmusic::debug_try(id).await;
        match r { Ok(v) => { let mut o = vec![]; grep(&v, String::new(), &mut o); println!("RECAP {id}: ok, {} menções", o.len()); for l in o.iter().take(6) { println!("RECAP   {l}"); } } Err(e) => println!("RECAP {id}: erro {e}") }
    }
}

#[tokio::test]
#[ignore]
async fn net_conta_recap2() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let p = super::ytmusic::library("playlists").await.unwrap();
    for i in &p.items { if let Some(c) = &i.collection { println!("RECAP2 {} | {} | {} | {}", c.kind, c.id, c.title, c.subtitle); } }
}

#[tokio::test]
#[ignore]
async fn net_conta_recap3() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let p = super::ytmusic::page("VLLRYRDYrUwsfcDMKUwM2iXj55L7vhMePF0bWDZ").await.unwrap();
    let min: u64 = p.tracks.iter().filter_map(|t| t.duration_ms).sum::<u64>() / 60000;
    println!("RECAP3 {:?}: {} faixas, {} min, com álbum {}, 1ª {:?}", p.title, p.tracks.len(), min, p.tracks.iter().filter(|t| t.album.is_some()).count(), p.tracks.first().map(|t| (&t.title, &t.artists)));
}

#[tokio::test]
#[ignore]
async fn net_explorar() {
    use std::collections::BTreeMap;
    fn count(v: &serde_json::Value, m: &mut BTreeMap<String, usize>) {
        match v {
            serde_json::Value::Object(o) => for (k, x) in o { if k.ends_with("Renderer") && matches!(k.as_str(), "musicCarouselShelfRenderer"|"musicShelfRenderer"|"gridRenderer"|"musicNavigationButtonRenderer"|"musicTwoRowItemRenderer"|"musicResponsiveListItemRenderer"|"musicPlaylistShelfRenderer"|"musicCardShelfRenderer"|"musicImmersiveCarouselShelfRenderer") { *m.entry(k.clone()).or_default() += 1; } count(x, m); },
            serde_json::Value::Array(a) => a.iter().for_each(|x| count(x, m)),
            _ => {}
        }
    }
    for id in ["FEmusic_explore", "FEmusic_new_releases", "FEmusic_new_releases_albums", "FEmusic_new_releases_videos", "FEmusic_charts", "FEmusic_moods_and_genres"] {
        match super::ytmusic::debug_try(id).await { Ok(v) => { let mut m = BTreeMap::new(); count(&v, &mut m); println!("EXP {id}: {m:?}"); } Err(e) => println!("EXP {id}: erro {e}") }
    }
    let v = super::ytmusic::debug_try("FEmusic_moods_and_genres").await.unwrap();
    let mut o = vec![]; paths(&v, "musicNavigationButtonRenderer", String::new(), &mut o);
    println!("EXP tile ex: {}", o.first().map(|s| s.chars().take(500).collect::<String>()).unwrap_or_default());
    let mut o = vec![]; paths(&v, "gridHeaderRenderer", String::new(), &mut o); println!("EXP grid headers: {}", o.len());
}

#[tokio::test]
#[ignore]
async fn net_explorar2() {
    for (id, p) in [("FEmusic_explore", None), ("FEmusic_new_releases_albums", None), ("FEmusic_new_releases_videos", None), ("FEmusic_charts", None), ("FEmusic_moods_and_genres", None), ("FEmusic_moods_and_genres_category", Some("ggMPOg1uX1JOQWZFeDByc2Jm"))] {
        match super::ytmusic::explore(id, p).await {
            Ok(e) => println!("EXP2 {id}: {} seções [{}], {} grupos [{}]", e.sections.len(), e.sections.iter().map(|s| format!("{}({} {})", s.title, s.items.len(), s.layout)).collect::<Vec<_>>().join("; "), e.groups.len(), e.groups.iter().map(|g| format!("{}({})", g.title, g.tiles.len())).collect::<Vec<_>>().join("; ")),
            Err(er) => println!("EXP2 {id}: erro {er}"),
        }
    }
}

#[tokio::test]
#[ignore]
async fn net_explorar3() {
    let v = super::ytmusic::debug_try("FEmusic_charts").await.unwrap();
    let mut o = vec![]; paths(&v, "musicShelfRenderer", String::new(), &mut o);
    println!("EXP3 shelf: {}", o.first().map(|s| s.chars().take(900).collect::<String>()).unwrap_or_default());
    let mut o = vec![]; paths(&v, "musicCarouselShelfRenderer", String::new(), &mut o); println!("EXP3 carrosséis: {}", o.len());
    for l in &o { println!("EXP3  {}", l.chars().take(150).collect::<String>()); }
}

#[tokio::test]
#[ignore]
async fn net_lastfm_chave_invalida() {
    // sem credenciais reais: confirma que a requisição assinada chega e o erro da API é lido
    let r = crate::lastfm::login(Some("00000000000000000000000000000000".into()), Some("11111111111111111111111111111111".into()), "x", "y").await;
    println!("LASTFM {:?}", r);
    assert!(r.is_err());
}

#[tokio::test]
#[ignore]
async fn net_sc_playlist_publica() {
    let v = super::soundcloud::api("https://api-v2.soundcloud.com/search/playlists", &[("q", "lofi hip hop".into()), ("limit", "3".into())]).await.unwrap();
    let id = v["collection"][0]["id"].as_u64().unwrap();
    let p = super::sc_account::playlist(&id.to_string()).await.unwrap();
    println!("SCPL {:?}: {} faixas, 1ª {:?}", p.title, p.tracks.len(), p.tracks.first().map(|t| t.title.clone()));
    assert!(!p.tracks.is_empty());
}

#[tokio::test]
#[ignore]
async fn net_inicio_outras_fontes() {
    for p in ["soundcloud", "deezer"] {
        match super::other_home(p).await {
            Ok(s) => println!("INICIO {p}: {}", s.iter().map(|x| format!("{} ({})", x.title, x.items.len())).collect::<Vec<_>>().join("; ")),
            Err(e) => println!("INICIO {p}: erro {e}"),
        }
    }
    println!("INICIO spotify sem login: {:?}", super::other_home("spotify").await.err());
}

#[tokio::test]
#[ignore]
async fn net_spotify_autorizacao_do_dispositivo() {
    // sem login: só confirma que o Spotify ainda aceita o client id e o escopo do MetroFuse e devolve o código
    let r = crate::http::CLIENT.post("https://accounts.spotify.com/oauth2/device/authorize").header("User-Agent", "Spotify/126600447 Win32_x86_64/0 (PC laptop)")
        .form(&[("client_id", "65b708073fc0480ea92a077233ca87bd"), ("scope", "user-read-private,user-library-read")]).send().await.unwrap();
    let st = r.status();
    let body = r.text().await.unwrap();
    println!("SPDEV {st} {}", body.chars().take(300).collect::<String>());
    assert!(st.is_success() && body.contains("device_code"));
}

fn find_strings(v: &serde_json::Value, needle: &str, here: String, out: &mut Vec<String>) {
    match v {
        serde_json::Value::String(s) => { if s.contains(needle) { out.push(format!("{here} = {}", s.chars().take(60).collect::<String>())); } }
        serde_json::Value::Object(m) => for (k, x) in m { find_strings(x, needle, format!("{here}.{k}"), out); },
        serde_json::Value::Array(a) => for (i, x) in a.iter().enumerate() { find_strings(x, needle, format!("{here}[{i}]"), out); },
        _ => {}
    }
}

#[tokio::test]
#[ignore]
async fn net_yt_ids() {
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let liked = super::ytmusic::library("songs").await.unwrap();
    let alb = liked.tracks.iter().find_map(|t| t.album_id.clone()).unwrap();
    let v = super::ytmusic::debug_raw(&alb).await;
    let mut o = vec![]; find_strings(&v, "OLAK5uy", String::new(), &mut o);
    println!("YTIDS álbum {alb}: {} ocorrências de OLAK5uy", o.len()); for l in o.iter().filter(|l| l.contains("watchEndpoint") || l.contains("Playlist")).take(3) { let t: String = l.chars().rev().take(150).collect::<Vec<_>>().into_iter().rev().collect(); println!("YTIDS   …{t}"); }
    let pls = super::ytmusic::library("playlists").await.unwrap();
    for it in pls.items.iter().take(8) { if let Some(c) = &it.collection { println!("YTIDS playlist {:?} {}", c.title, c.id); } }
    let own = pls.items.iter().filter_map(|i| i.collection.as_ref()).find(|c| c.subtitle.contains("Carlos") && c.id.starts_with("VLPL")).map(|c| c.id.clone());
    if let Some(id) = own {
        let v = super::ytmusic::debug_raw(&id).await;
        let mut o = vec![]; find_strings(&v, "", String::new(), &mut o);
        let set: Vec<_> = o.iter().filter(|l| l.contains("playlistSetVideoId") || l.contains("PlaylistSetVideoId")).take(2).collect();
        for l in set.iter() { let t: String = l.chars().rev().take(150).collect::<Vec<_>>().into_iter().rev().collect(); println!("YTIDS setVideoId …{t}"); }
        let mut h = vec![]; paths(&v, "musicEditablePlaylistDetailHeaderRenderer", String::new(), &mut h); println!("YTIDS cabeçalho editável: {}", h.len());
    }
}

#[tokio::test]
#[ignore]
async fn net_yt_playlists_editaveis() {
    // SÓ LEITURA: a lista que o botão "Salvar na playlist" do site usa
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let v = super::ytmusic::editable_playlists(None).await;
    match v { Ok(l) => println!("YTEDIT {} playlists editáveis: {:?}", l.len(), l.iter().take(6).map(|c| (&c.title, &c.id)).collect::<Vec<_>>()), Err(e) => println!("YTEDIT erro: {e}") }
}

/// Escritas reais no YouTube Music, sempre desfeitas: cria uma playlist de teste, mexe nela e a apaga.
///   MM_AUTH_DIR=<pasta do app> cargo test net_yt_escritas -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn net_yt_escritas() {
    use super::ytmusic as yt;
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let liked = yt::library("songs").await.unwrap();
    let vids: Vec<String> = liked.tracks.iter().map(|t| t.id.clone()).take(3).collect();
    assert!(vids.len() == 3, "preciso de 3 músicas curtidas para testar");
    let mut log: Vec<String> = vec![];
    macro_rules! ok { ($nome:expr, $r:expr) => { match $r { Ok(v) => { log.push(format!("OK   {}", $nome)); Some(v) } Err(e) => { log.push(format!("ERRO {}: {e}", $nome)); None } } } }

    // 1) criar já com a primeira música
    let pid = ok!("criar playlist", yt::create_playlist("MetroMusic teste (apagar)", &vids[..1]).await);
    if let Some(pid) = pid {
        let tracks = |pid: String| async move { yt::page(&format!("VL{pid}")).await.map(|p| p.tracks) };
        let n = tracks(pid.clone()).await.map(|t| t.len()).unwrap_or(0);
        log.push(format!("     faixas após criar: {n} (esperado 1)"));
        // 2) adicionar duas
        ok!("adicionar 2 músicas", yt::add_to_playlist(&pid, &vids[1..3]).await);
        let t = tracks(pid.clone()).await.unwrap_or_default();
        log.push(format!("     faixas após adicionar: {} (esperado 3); setId presente: {}", t.len(), t.iter().all(|x| x.set_id.is_some())));
        // 3) mover a última para antes da primeira
        if t.len() == 3 {
            ok!("mover a 3ª antes da 1ª", yt::move_in_playlist(&pid, t[2].set_id.as_deref().unwrap(), t[0].set_id.as_deref()).await);
            let t2 = tracks(pid.clone()).await.unwrap_or_default();
            log.push(format!("     ordem depois de mover: {:?} (esperado a antiga 3ª na frente: {})", t2.iter().map(|x| x.id.clone()).collect::<Vec<_>>(), t2.first().map(|x| x.id == t[2].id).unwrap_or(false)));
        }
        // 4) renomear
        ok!("renomear", yt::rename_playlist(&pid, "MetroMusic teste renomeada").await);
        let lib = yt::library("playlists").await.unwrap();
        let achou = lib.items.iter().filter_map(|i| i.collection.as_ref()).any(|c| c.title == "MetroMusic teste renomeada");
        log.push(format!("     nome novo aparece na biblioteca: {achou}"));
        // 5) remover uma (sem informar o setId: ele é procurado)
        ok!("remover 1 música", yt::remove_from_playlist(&pid, &[(vids[1].clone(), None)]).await);
        let n2 = tracks(pid.clone()).await.map(|t| t.len()).unwrap_or(0);
        log.push(format!("     faixas após remover: {n2} (esperado 2)"));
        // 6) aparece nas editáveis
        let ed = yt::editable_playlists(None).await.unwrap_or_default();
        log.push(format!("     aparece em 'editáveis': {}", ed.iter().any(|c| c.id.contains(&pid))));
        // 7) apagar
        ok!("excluir playlist", yt::delete_playlist(&pid).await);
        let lib = yt::library("playlists").await.unwrap();
        log.push(format!("     sumiu da biblioteca: {}", !lib.items.iter().filter_map(|i| i.collection.as_ref()).any(|c| c.id.contains(&pid))));
    }

    // 8) salvar / remover da biblioteca: playlist pública, álbum e artista (todos fora da sua biblioteca)
    let before = yt::library("playlists").await.unwrap().items.len();
    let pub_pl = "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"; // playlist pública qualquer
    ok!("salvar playlist de terceiros", yt::library_save("playlist", pub_pl, true).await);
    let mid = yt::library("playlists").await.unwrap().items.len();
    ok!("remover playlist de terceiros", yt::library_save("playlist", pub_pl, false).await);
    let after = yt::library("playlists").await.unwrap().items.len();
    log.push(format!("     playlists na biblioteca: {before} → {mid} → {after} (esperado +1 e volta)"));

    let alb = liked.tracks.iter().filter_map(|t| t.album_id.clone()).find(|a| !a.is_empty()).unwrap();
    let albs_antes = yt::page("FEmusic_liked_albums").await.map(|p| p.items.len()).unwrap_or(0);
    ok!("salvar álbum", yt::library_save("album", &alb, true).await);
    let albs_meio = yt::page("FEmusic_liked_albums").await.map(|p| p.items.len()).unwrap_or(0);
    ok!("remover álbum", yt::library_save("album", &alb, false).await);
    let albs_dep = yt::page("FEmusic_liked_albums").await.map(|p| p.items.len()).unwrap_or(0);
    log.push(format!("     álbuns salvos: {albs_antes} → {albs_meio} → {albs_dep}"));

    let art = liked.tracks.iter().filter_map(|t| t.artist_id.clone()).next().unwrap();
    ok!("seguir artista", yt::library_save("artist", &art, true).await);
    ok!("deixar de seguir", yt::library_save("artist", &art, false).await);

    println!("\nYTW ===== RESULTADO =====");
    for l in &log { println!("YTW {l}"); }
}

/// Salvar playlist de terceiros e seguir artista no YouTube Music, com itens reais do Explorar e conferência por leitura.
#[tokio::test]
#[ignore]
async fn net_yt_salvar_e_seguir() {
    use super::ytmusic as yt;
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let ids = |p: &yt::Page| p.items.iter().filter_map(|i| i.collection.as_ref()).map(|c| c.id.clone()).collect::<Vec<_>>();
    // playlist de terceiros: a primeira playlist de uma página de clima
    let ex = yt::explore("FEmusic_moods_and_genres_category", Some("ggMPOg1uX1JOQWZFeDByc2Jm")).await.unwrap();
    let pl = ex.sections.iter().flat_map(|s| s.items.iter()).filter_map(|i| i.collection.as_ref()).find(|c| c.kind == "playlist").map(|c| (c.id.clone(), c.title.clone())).unwrap();
    let before = ids(&yt::library("playlists").await.unwrap());
    println!("YTS playlist de teste: {:?} ({}); já na biblioteca: {}", pl.1, pl.0, before.contains(&pl.0));
    let r1 = yt::library_save("playlist", &pl.0, true).await;
    let mid = ids(&yt::library("playlists").await.unwrap());
    let r2 = yt::library_save("playlist", &pl.0, false).await;
    let after = ids(&yt::library("playlists").await.unwrap());
    println!("YTS salvar playlist: {:?} | na biblioteca depois de salvar: {} | depois de remover: {} | total {} → {} → {}", r1.is_ok(), mid.contains(&pl.0), after.contains(&pl.0), before.len(), mid.len(), after.len());
    // artista: o primeiro de "Top artists" das paradas
    let ch = yt::explore("FEmusic_charts", None).await.unwrap();
    let art = ch.sections.iter().flat_map(|s| s.items.iter()).filter_map(|i| i.collection.as_ref()).find(|c| c.kind == "artist").map(|c| (c.id.clone(), c.title.clone())).unwrap();
    let a0 = ids(&yt::library("artists").await.unwrap());
    let f1 = yt::library_save("artist", &art.0, true).await;
    let a1 = ids(&yt::library("artists").await.unwrap());
    let f2 = yt::library_save("artist", &art.0, false).await;
    let a2 = ids(&yt::library("artists").await.unwrap());
    println!("YTS artista {:?}: seguir {:?}, deixar {:?} | seguido depois de seguir: {} | depois de deixar: {} | total {} → {} → {}", art.1, f1.is_ok(), f2.is_ok(), a1.contains(&art.0), a2.contains(&art.0), a0.len(), a1.len(), a2.len());
}

#[tokio::test]
#[ignore]
async fn net_yt_estado_final() {
    use super::ytmusic as yt;
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let ids = |p: &yt::Page| p.items.iter().filter_map(|i| i.collection.as_ref()).map(|c| c.id.clone()).collect::<Vec<_>>();
    let ch = yt::explore("FEmusic_charts", None).await.unwrap();
    let art = ch.sections.iter().flat_map(|s| s.items.iter()).filter_map(|i| i.collection.as_ref()).find(|c| c.kind == "artist").map(|c| (c.id.clone(), c.title.clone())).unwrap();
    let pl = "VLRDCLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc".to_string();
    for espera in [0u64, 8, 8] {
        tokio::time::sleep(std::time::Duration::from_secs(espera)).await;
        let a = ids(&yt::library("artists").await.unwrap());
        let p = ids(&yt::library("playlists").await.unwrap());
        println!("YTF após +{espera}s: artista {:?} seguido={} (total {}) | playlist de teste na biblioteca={} (total {})", art.1, a.contains(&art.0), a.len(), p.contains(&pl), p.len());
    }
}

#[tokio::test]
#[ignore]
async fn net_yt_salvar_e_seguir_com_espera() {
    use super::ytmusic as yt;
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let ids = |p: &yt::Page| p.items.iter().filter_map(|i| i.collection.as_ref()).map(|c| c.id.clone()).collect::<Vec<_>>();
    // espera até 20 s a leitura refletir o estado `quer`
    async fn ate(kind: &str, id: &str, quer: bool) -> (bool, u64) {
        for s in 0..10u64 {
            let p = super::ytmusic::library(kind).await.unwrap();
            let tem = p.items.iter().filter_map(|i| i.collection.as_ref()).any(|c| c.id == id);
            if tem == quer { return (true, s * 2); }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        (false, 20)
    }
    let ch = yt::explore("FEmusic_charts", None).await.unwrap();
    let art = ch.sections.iter().flat_map(|s| s.items.iter()).filter_map(|i| i.collection.as_ref()).find(|c| c.kind == "artist").map(|c| (c.id.clone(), c.title.clone())).unwrap();
    let pl = "VLRDCLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc".to_string();
    let _ = ids;
    yt::library_save("artist", &art.0, true).await.unwrap();
    let (a_seg, ta) = ate("artists", &art.0, true).await;
    yt::library_save("artist", &art.0, false).await.unwrap();
    let (a_dei, tb) = ate("artists", &art.0, false).await;
    println!("YTG artista {:?}: apareceu como seguido={a_seg} (em ~{ta}s); sumiu depois de deixar={a_dei} (em ~{tb}s)", art.1);
    yt::library_save("playlist", &pl, true).await.unwrap();
    let (p_sal, tc) = ate("playlists", &pl, true).await;
    yt::library_save("playlist", &pl, false).await.unwrap();
    let (p_rem, td) = ate("playlists", &pl, false).await;
    println!("YTG playlist de terceiros: apareceu na biblioteca={p_sal} (em ~{tc}s); sumiu depois de remover={p_rem} (em ~{td}s)");
}

/// Salva de verdade playlists reais de vários tipos e confere quais ficam na biblioteca. NUNCA mexe no que já estava salvo.
#[tokio::test]
#[ignore]
async fn net_yt_salvar_varios_tipos() {
    use super::ytmusic as yt;
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let mut fontes: Vec<yt::Explore> = vec![];
    for (id, p) in [("FEmusic_charts", None), ("FEmusic_explore", None), ("FEmusic_moods_and_genres_category", Some("ggMPOg1uX1JOQWZFeDByc2Jm")), ("FEmusic_moods_and_genres_category", Some("ggMPOg1xTkdfUUFZX0F3QWVn"))] {
        if let Ok(e) = yt::explore(id, p).await { fontes.push(e); }
    }
    let lib0 = yt::library("playlists").await.unwrap();
    let na_biblioteca: std::collections::HashSet<String> = lib0.items.iter().filter_map(|i| i.collection.as_ref()).map(|c| c.id.trim_start_matches("VL").to_string()).collect();
    let mut prefixos = std::collections::HashSet::new();
    let mut cand = vec![];
    for e in &fontes { for sec in &e.sections { for i in &sec.items { if let Some(c) = &i.collection {
        let chave = c.id.trim_start_matches("VL").chars().take(4).collect::<String>();
        if c.kind == "playlist" && !na_biblioteca.contains(c.id.trim_start_matches("VL")) && prefixos.insert(chave) { cand.push((c.id.clone(), c.title.clone())); }
    } } } }
    println!("YTV {} candidatos de prefixos diferentes (nenhum já salvo)", cand.len());
    for (id, title) in cand.into_iter().take(8) {
        let r = yt::library_save("playlist", &id, true).await;
        let mut ok = false;
        for _ in 0..6 { tokio::time::sleep(std::time::Duration::from_secs(2)).await; let l = yt::library("playlists").await.unwrap(); if l.items.iter().filter_map(|i| i.collection.as_ref()).any(|c| c.id.trim_start_matches("VL") == id.trim_start_matches("VL")) { ok = true; break; } }
        let _ = yt::library_save("playlist", &id, false).await; // só desfaz o que ESTE teste salvou
        println!("YTV {:6} chamada={} ficou salva={ok} — {title:?}", id.trim_start_matches("VL").chars().take(6).collect::<String>(), match &r { Ok(_) => "ok".to_string(), Err(e) => format!("ERRO {e}") });
    }
}

/// Restaura a playlist que um teste removeu por engano.
#[tokio::test]
#[ignore]
async fn net_yt_restaurar_recap() {
    use super::ytmusic as yt;
    let dir = std::env::var("MM_AUTH_DIR").expect("MM_AUTH_DIR");
    crate::providers::auth::init(std::path::PathBuf::from(dir).join("youtube-auth.json"));
    let id = "VLLRSRIZEb4lrETswxF7mj1U71QzPbkrDdZ3y2g";
    println!("YTR salvar: {:?}", yt::library_save("playlist", id, true).await);
    for s in 0..8 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let lib = yt::library("playlists").await.unwrap();
        let tem = lib.items.iter().filter_map(|i| i.collection.as_ref()).any(|c| c.id == id);
        println!("YTR após {}s: March-May Recap na biblioteca = {tem} (total {})", (s + 1) * 3, lib.items.len());
        if tem { break; }
    }
}
