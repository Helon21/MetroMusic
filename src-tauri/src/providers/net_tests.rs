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
