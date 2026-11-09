//! Pré-cache das próximas faixas da fila. Porte da política do `NextTrackPreloadCoordinator` (MetroFuse):
//! baixa só o começo de cada faixa (25 s / 17 s / 10 s conforme a distância na fila), uma de cada vez,
//! cancela o que saiu da janela e tenta de novo até 3 vezes, com 15 s entre as tentativas.

use crate::cache::{Cache, Refresh};
use crate::model::{now_ms, TrackInfo};
use crate::providers;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;

pub const MAX_COUNT: usize = 10;
const RETRY_DELAY_MS: u64 = 15_000;
const MAX_FAILED_ATTEMPTS: u32 = 3;
const KIB: u64 = 1024;
const MIB: u64 = 1024 * KIB;
const FALLBACK_BITRATE: u64 = 256_000;

/// Quantos bytes baixar da faixa que está `distance` posições à frente.
pub fn target_bytes(distance: usize, bitrate: u32, content_length: Option<u64>) -> u64 {
    let (seconds, maximum) = match distance { 1 => (25, 8 * MIB), 2 => (17, 5 * MIB), _ => (10, 3 * MIB) };
    let bitrate = if bitrate > 0 { bitrate as u64 } else { FALLBACK_BITRATE };
    let bounded = (bitrate * seconds / 8).clamp(512 * KIB, maximum);
    content_length.filter(|l| *l > 0).map_or(bounded, |l| bounded.min(l))
}

#[derive(Default)]
struct State {
    active: HashMap<String, JoinHandle<()>>,
    completed: HashSet<String>,
    failures: HashMap<String, (u32, u64)>,
    /// Última janela pedida, para reavaliar depois de uma falha.
    last: Option<(Vec<(TrackInfo, usize)>, Vec<String>)>,
}

pub struct Preloader {
    cache: Arc<Cache>,
    sem: Arc<Semaphore>,
    st: Mutex<State>,
}

impl Preloader {
    pub fn new(cache: Arc<Cache>) -> Arc<Self> {
        Arc::new(Preloader { cache, sem: Arc::new(Semaphore::new(1)), st: Mutex::new(State::default()) })
    }

    /// Define a janela de pré-carga (na ordem de prioridade). Cancela o que saiu e inicia o que entrou.
    pub fn update(self: &Arc<Self>, targets: Vec<(TrackInfo, usize)>, order: Vec<String>) {
        let wanted: Vec<String> = targets.iter().map(|(t, _)| t.key()).collect();
        let now = now_ms();
        let mut st = self.st.lock();
        st.last = Some((targets.clone(), order.clone()));
        // fora da janela: cancela e solta o que já tinha começado a baixar
        let gone: Vec<String> = st.active.keys().filter(|k| !wanted.contains(k)).cloned().collect();
        for k in gone { if let Some(h) = st.active.remove(&k) { h.abort(); } }
        st.completed.retain(|k| wanted.contains(k));
        st.failures.retain(|k, _| wanted.contains(k));
        for (track, distance) in targets {
            let key = track.key();
            if st.active.contains_key(&key) || st.completed.contains(&key) { continue; }
            if st.failures.get(&key).map_or(false, |(n, at)| *n >= MAX_FAILED_ATTEMPTS || now - at < RETRY_DELAY_MS) { continue; }
            let me = self.clone();
            let order = order.clone();
            let k = key.clone();
            st.active.insert(key, tokio::spawn(async move { me.job(k, track, distance, order).await }));
        }
    }

    async fn job(self: Arc<Self>, key: String, track: TrackInfo, distance: usize, order: Vec<String>) {
        let result = async {
            let _permit = self.sem.acquire().await.map_err(|e| e.to_string())?; // uma faixa por vez
            let stream = providers::resolve(&track, &order).await?;
            let entry = self.cache.entry_for(&stream);
            let want = target_bytes(distance, stream.bitrate, stream.content_length);
            if entry.have() >= want || entry.is_complete() { return Ok(()); }
            let t = track.clone();
            let ord = order.clone();
            let refresh: Refresh = Arc::new(move || { let (t, o) = (t.clone(), ord.clone()); Box::pin(async move { providers::invalidate(&t.provider, &t.id); providers::resolve(&t, &o).await }) });
            self.cache.fetch(&entry, stream, want, Some(refresh));
            entry.wait_ready(want, Duration::from_secs(60)).await
        }.await;
        let mut st = self.st.lock();
        st.active.remove(&key);
        match result {
            Ok(()) => { st.failures.remove(&key); st.completed.insert(key); }
            Err(e) => {
                eprintln!("[preload] {key} falhou: {e}");
                let n = st.failures.get(&key).map_or(0, |f| f.0) + 1;
                st.failures.insert(key.clone(), (n, now_ms()));
                if n < MAX_FAILED_ATTEMPTS {
                    // reavalia depois do intervalo, como o MetroFuse (requestRefresh após RETRY_DELAY)
                    let me = self.clone();
                    drop(st);
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
                        let last = me.st.lock().last.clone();
                        if let Some((targets, order)) = last { me.update(targets, order); }
                    });
                }
            }
        }
    }

    pub fn clear(&self) {
        let mut st = self.st.lock();
        for (_, h) in st.active.drain() { h.abort(); }
        st.completed.clear();
        st.failures.clear();
        st.last = None;
    }
}

#[cfg(test)]
mod tests {
    use super::target_bytes;
    #[test]
    fn bytes_por_distancia() {
        // 128 kbps: 25 s = 400 KB (acima do mínimo de 512 KiB? não: sobe para 512 KiB)
        assert_eq!(target_bytes(1, 128_000, None), 512 * 1024);
        // 256 kbps, distância 1: 25 s = 800 KB
        assert_eq!(target_bytes(1, 256_000, None), 800_000);
        // limitado pelo tamanho do arquivo
        assert_eq!(target_bytes(1, 256_000, Some(300_000)), 300_000);
        // sem taxa conhecida assume 256 kbps; distância 3 = 10 s = 320 KB -> mínimo 512 KiB
        assert_eq!(target_bytes(3, 0, None), 512 * 1024);
    }
}
