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
