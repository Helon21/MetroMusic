//! Orquestra a reprodução: resolve o stream, garante o download em cache e entrega ao motor.

use crate::audio::{Emit, Engine, LoadMeta};
use crate::cache::{Cache, Entry, Refresh, FULL};
use crate::model::{Res, TrackInfo};
use crate::preload::{Preloader, MAX_COUNT};
use crate::providers;
use parking_lot::Mutex;
use serde_json::json;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Bytes mínimos antes de entregar ao decodificador (o resto chega enquanto ele lê).
const START_BYTES: u64 = 48 * 1024;
const START_TIMEOUT: Duration = Duration::from_secs(25);

struct Current {
    track: TrackInfo,
    entry: Arc<Entry>,
    cancel: Arc<AtomicBool>,
}

pub struct Player {
    pub cache: Arc<Cache>,
    preload: Arc<Preloader>,
    engine: Option<Engine>,
    emit: Emit,
    token: AtomicU64,
    current: Mutex<Option<Current>>,
}

impl Player {
    pub fn new(cache_root: PathBuf, cache_limit_mb: u64, emit: Emit) -> Arc<Player> {
        let cache = Cache::open(cache_root, cache_limit_mb);
        let engine = match Engine::start(emit.clone()) {
            Ok(e) => Some(e),
            Err(e) => { eprintln!("[áudio] motor indisponível: {e}"); None }
        };
        Arc::new(Player { preload: Preloader::new(cache.clone()), cache, engine, emit, token: AtomicU64::new(0), current: Mutex::new(None) })
    }

    fn engine(&self) -> Res<&Engine> { self.engine.as_ref().ok_or_else(|| "sem dispositivo de saída de áudio".to_string()) }

    pub fn protected(&self) -> HashSet<String> {
        self.current.lock().as_ref().map(|c| HashSet::from([c.entry.key.clone()])).unwrap_or_default()
    }

    /// Começa a tocar `track`. Devolve na hora o token da reprodução; o resto acontece em segundo plano
    /// e é narrado pelos eventos `audio:*` (todos carregam o token, para a interface ignorar os atrasados).
    pub fn play(self: &Arc<Self>, track: TrackInfo, start: f64, autoplay: bool, order: Vec<String>) -> Res<u64> {
        self.engine()?;
        let token = self.token.fetch_add(1, Ordering::SeqCst) + 1;
        // a faixa anterior deixa de baixar (o que já veio continua valendo como pré-cache)
        if let Some(prev) = self.current.lock().take() {
            prev.cancel.store(true, Ordering::Relaxed);
            self.cache.lower_target(&prev.entry, prev.entry.have());
        }
        (self.emit)("audio:state", json!({ "token": token, "state": "loading", "key": track.key() }));
        let me = self.clone();
        tokio::spawn(async move {
            if let Err(e) = me.start_track(token, track, start, autoplay, order).await {
                if me.token.load(Ordering::SeqCst) == token {
                    (me.emit)("audio:state", json!({ "token": token, "state": "error", "message": e }));
                }
            }
        });
        Ok(token)
    }

    async fn start_track(self: &Arc<Self>, token: u64, track: TrackInfo, start: f64, autoplay: bool, order: Vec<String>) -> Res<()> {
        let stream = providers::resolve(&track, &order).await?;
        if self.token.load(Ordering::SeqCst) != token { return Ok(()); }
        let entry = self.cache.entry_for(&stream);
        entry.touch();
        let (t, o) = (track.clone(), order.clone());
        let refresh: Refresh = Arc::new(move || { let (t, o) = (t.clone(), o.clone()); Box::pin(async move { providers::invalidate(&t.provider, &t.id); providers::resolve(&t, &o).await }) });
        let (source, codec, bitrate) = (stream.source.clone(), stream.codec.clone(), stream.bitrate);
        self.cache.fetch(&entry, stream, FULL, Some(refresh));
        entry.wait_ready(START_BYTES, START_TIMEOUT).await?;
        if self.token.load(Ordering::SeqCst) != token { return Ok(()); }

        let cancel = Arc::new(AtomicBool::new(false));
        let (e2, c2) = (entry.clone(), cancel.clone());
        // A busca reabre o arquivo em cache, então o motor recebe um abridor e não um leitor.
        let open: Box<dyn Fn() -> std::io::Result<crate::cache::Reader> + Send> = Box::new(move || e2.reader(c2.clone()));
        let meta = LoadMeta { token, key: track.key(), source, codec, bitrate, duration_hint: track.duration_ms.map(|d| d as f64 / 1000.0) };
        let ext = entry.ext.clone();
        *self.current.lock() = Some(Current { track, entry, cancel: cancel.clone() });
        self.engine()?.load(open, ext, start, autoplay, cancel, meta);
        self.cache.trim(&self.protected());
        Ok(())
    }

    pub fn pause(&self) -> Res<()> { self.engine()?.pause(); Ok(()) }
    pub fn resume(&self) -> Res<()> { self.engine()?.resume(); Ok(()) }
    pub fn seek(&self, secs: f64) -> Res<()> { self.engine()?.seek(secs); Ok(()) }
    pub fn set_volume(&self, v: f32) -> Res<()> { self.engine()?.set_volume(v); Ok(()) }
    pub fn set_speed(&self, s: f32) -> Res<()> { self.engine()?.set_speed(s); Ok(()) }
    pub fn stop(&self) -> Res<()> {
        self.token.fetch_add(1, Ordering::SeqCst);
        if let Some(c) = self.current.lock().take() { c.cancel.store(true, Ordering::Relaxed); }
        self.engine()?.stop();
        Ok(())
    }
    pub fn position(&self) -> f64 { self.engine.as_ref().map_or(0.0, |e| e.position()) }
    pub fn current_track(&self) -> Option<TrackInfo> { self.current.lock().as_ref().map(|c| c.track.clone()) }

    /// Define as próximas faixas da fila (em ordem) a pré-carregar. `count` limita quantas; 0 desliga.
    pub fn precache(self: &Arc<Self>, next: Vec<TrackInfo>, count: usize, order: Vec<String>) {
        if count == 0 || !self.cache.enabled.load(Ordering::Relaxed) { self.preload.clear(); return; }
        let cur = self.current.lock().as_ref().map(|c| c.track.key());
        let mut seen = HashSet::new();
        let targets: Vec<(TrackInfo, usize)> = next.into_iter()
            .filter(|t| Some(t.key()) != cur && seen.insert(t.key()))
            .take(count.min(MAX_COUNT)).enumerate().map(|(i, t)| (t, i + 1)).collect();
        self.preload.update(targets, order);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    type Log = Arc<Mutex<Vec<(String, Value)>>>;

    async fn wait_for(log: &Log, from: usize, timeout_s: u64, pred: impl Fn(&str, &Value) -> bool) -> Option<(usize, Value)> {
        let t0 = std::time::Instant::now();
        loop {
            {
                let l = log.lock();
                for (i, (name, v)) in l.iter().enumerate().skip(from) { if pred(name, v) { return Some((i, v.clone())); } }
            }
            if t0.elapsed().as_secs() > timeout_s { return None; }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// Reprodução de ponta a ponta com o dispositivo real, em silêncio (volume 0):
    ///   cargo test net_reproducao -- --ignored --nocapture
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn net_reproducao_completa() {
        let root = std::env::temp_dir().join(format!("metromusic-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let log: Log = Arc::new(Mutex::new(vec![]));
        let l2 = log.clone();
        let emit: Emit = Arc::new(move |n, v| { if n != "audio:position" { println!("  evento {n} {v}"); } l2.lock().push((n.to_string(), v)); });
        let player = Player::new(root.clone(), 512, emit);
        player.set_volume(0.0).expect("motor de áudio (sem dispositivo?)");
        let order = vec!["youtube".to_string(), "soundcloud".to_string()];

        for (label, track) in [
            ("SoundCloud (HLS)", providers::soundcloud::search("daft punk one more time", 3).await.unwrap().remove(0)),
            ("YouTube Music", providers::youtube::search("blinding lights the weeknd", 3).await.unwrap().remove(0)),
            ("Deezer -> correspondência", providers::deezer::search("blinding lights the weeknd", 3).await.unwrap().remove(0)),
        ] {
            println!("\n== {label}: {} — {}", track.title, track.artist_line());
            let from = log.lock().len();
            let t0 = std::time::Instant::now();
            let token = player.play(track.clone(), 0.0, true, order.clone()).unwrap();
            let first = wait_for(&log, from, 30, |n, v| n == "audio:position" && v["token"] == token && v["position"].as_f64().unwrap_or(0.0) > 0.5).await;
            assert!(first.is_some(), "não começou a tocar");
            println!("  tocando após {:.1}s", t0.elapsed().as_secs_f64());
            let loaded = wait_for(&log, from, 5, |n, v| n == "audio:loaded" && v["token"] == token).await.expect("audio:loaded").1;
            println!("  fonte={} codec={} duração={}", loaded["source"], loaded["codec"], loaded["duration"]);
            assert!(loaded["duration"].as_f64().unwrap_or(0.0) > 60.0);

            // buscar para 90 s: a posição seguinte tem de ser perto disso
            let idx = log.lock().len();
            player.seek(90.0).unwrap();
            let after = wait_for(&log, idx, 15, |n, v| n == "audio:position" && v["token"] == token && v["position"].as_f64().unwrap_or(0.0) > 89.0).await;
            let pos = after.as_ref().map(|a| a.1["position"].as_f64().unwrap_or(0.0));
            println!("  após seek(90): {pos:?}");
            assert!(pos.map_or(false, |p| p > 89.0 && p < 95.0), "busca fora do esperado: {pos:?}");

            // pausar: a posição para
            let idx = log.lock().len();
            player.pause().unwrap();
            assert!(wait_for(&log, idx, 5, |n, v| n == "audio:state" && v["state"] == "paused").await.is_some());
            tokio::time::sleep(Duration::from_millis(600)).await;
            let p1 = player.position();
            tokio::time::sleep(Duration::from_millis(900)).await;
            let p2 = player.position();
            println!("  pausado: {p1:.2}s -> {p2:.2}s");
            assert!((p2 - p1).abs() < 0.05, "a posição continuou andando em pausa");
            player.resume().unwrap();
            let idx = log.lock().len();
            assert!(wait_for(&log, idx, 5, |n, v| n == "audio:position" && v["position"].as_f64().unwrap_or(0.0) > p2).await.is_some());
            println!("  retomou");
        }

        // pré-cache: enfileira outra faixa e confere que baixou o começo
        println!("\n== pré-cache");
        let next = providers::youtube::search("daft punk get lucky", 3).await.unwrap().remove(0);
        player.precache(vec![next.clone()], 3, order.clone());
        let key = next.key();
        let t0 = std::time::Instant::now();
        let mut got = 0u64;
        while t0.elapsed().as_secs() < 30 {
            if let Some(e) = player.cache.get(&key) { got = e.have(); if got > 400_000 { break; } }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        println!("  {} -> {} KiB em cache após {:.1}s", key, got / 1024, t0.elapsed().as_secs_f64());
        assert!(got > 400_000, "o pré-cache não baixou o começo da próxima faixa");

        let st = player.cache.stats();
        println!("  cache: {} entradas, {} KiB", st.entries, st.bytes / 1024);
        assert!(st.entries >= 2);

        // o cache sobrevive a reiniciar
        drop(player);
        let reopened = Cache::open(root.clone(), 512);
        println!("  reaberto: {} entradas, {} KiB", reopened.stats().entries, reopened.stats().bytes / 1024);
        assert!(reopened.stats().entries >= 2);
        let _ = std::fs::remove_dir_all(&root);
    }
}
