//! Cache de áudio em disco.
//!
//! Cada faixa vira um arquivo que cresce em ordem (por blocos `Range` ou por segmentos HLS).
//! O decodificador lê esse arquivo enquanto ele ainda está sendo baixado, e o pré-cache baixa só
//! o começo das próximas faixas (retomado até o fim quando a faixa passa a tocar).
//! Quando passa do limite, descarta o que foi usado há mais tempo.

use crate::http::CLIENT;
use crate::model::{now_ms, Res, StreamInfo};
use futures_util::future::BoxFuture;
use parking_lot::{Condvar, Mutex};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const FULL: u64 = u64::MAX;
const FIRST_CHUNK: u64 = 512 * 1024;
const CHUNK: u64 = 2 * 1024 * 1024;
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_RETRIES: u32 = 3;

/// Como obter uma URL nova quando a atual expira no meio do download.
pub type Refresh = Arc<dyn Fn() -> BoxFuture<'static, Res<StreamInfo>> + Send + Sync>;

#[derive(Serialize, Deserialize, Default, Clone)]
struct Meta {
    key: String,
    ext: String,
    total: Option<u64>,
    complete: bool,
    last_used: u64,
    seg_next: usize,
    bitrate: u32,
    codec: String,
}

#[derive(Default)]
pub struct EntryState {
    /// Bytes contíguos já gravados, a partir do começo.
    pub have: u64,
    pub total: Option<u64>,
    pub complete: bool,
    pub error: Option<String>,
    target: u64,
    running: bool,
    seg_next: usize,
    last_used: u64,
}

pub struct Entry {
    pub key: String,
    pub path: PathBuf,
    meta_path: PathBuf,
    pub ext: String,
    pub bitrate: u32,
    pub codec: String,
    pub st: Mutex<EntryState>,
    cv: Condvar,
    /// Leitores abertos: uma entrada em uso não é descartada.
    pub readers: AtomicUsize,
}

impl Entry {
    fn persist(&self) {
        let s = self.st.lock();
        let meta = Meta { key: self.key.clone(), ext: self.ext.clone(), total: s.total, complete: s.complete, last_used: s.last_used, seg_next: s.seg_next, bitrate: self.bitrate, codec: self.codec.clone() };
        drop(s);
        let _ = fs::write(&self.meta_path, serde_json::to_vec(&meta).unwrap_or_default());
    }

    pub fn touch(&self) { self.st.lock().last_used = now_ms(); }
    pub fn have(&self) -> u64 { self.st.lock().have }
    pub fn is_complete(&self) -> bool { self.st.lock().complete }

    /// Espera (sem bloquear a thread) até haver `min` bytes, o fim do arquivo ou um erro.
    pub async fn wait_ready(&self, min: u64, timeout: Duration) -> Res<()> {
        let t0 = Instant::now();
        loop {
            {
                let s = self.st.lock();
                if let Some(e) = &s.error { return Err(e.clone()); }
                if s.complete || s.have >= min { return Ok(()); }
            }
            if t0.elapsed() > timeout { return Err("tempo esgotado esperando o áudio".into()); }
            tokio::time::sleep(Duration::from_millis(60)).await;
        }
    }

    /// Leitor para o decodificador. `cancel` interrompe leituras bloqueadas (troca de faixa).
    pub fn reader(self: &Arc<Self>, cancel: Arc<AtomicBool>) -> io::Result<Reader> {
        self.readers.fetch_add(1, Ordering::SeqCst);
        Ok(Reader { entry: self.clone(), file: fs::File::open(&self.path)?, pos: 0, cancel })
    }
}

pub struct Reader {
    entry: Arc<Entry>,
    file: fs::File,
    pos: u64,
    cancel: Arc<AtomicBool>,
}

impl Drop for Reader {
    fn drop(&mut self) { self.entry.readers.fetch_sub(1, Ordering::SeqCst); }
}

impl Reader {
    pub fn total(&self) -> Option<u64> { self.entry.st.lock().total }

    /// Bloqueia até existir pelo menos 1 byte em `pos` ou o fim. Devolve quantos bytes há para ler.
    fn available(&self) -> io::Result<u64> {
        let mut last_progress = Instant::now();
        let mut last_have = 0u64;
        let mut s = self.entry.st.lock();
        loop {
            if self.cancel.load(Ordering::Relaxed) { return Err(io::Error::new(io::ErrorKind::Interrupted, "leitura cancelada")); }
            if s.have > self.pos { return Ok(s.have - self.pos); }
            if s.complete { return Ok(0); }
            if let Some(e) = &s.error { return Err(io::Error::new(io::ErrorKind::Other, e.clone())); }
            if s.have != last_have { last_have = s.have; last_progress = Instant::now(); }
            if last_progress.elapsed() > READ_IDLE_TIMEOUT { return Err(io::Error::new(io::ErrorKind::TimedOut, "download parado")); }
            self.entry.cv.wait_for(&mut s, Duration::from_millis(150));
        }
    }
}

impl Read for Reader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() { return Ok(0); }
        let avail = self.available()?;
        if avail == 0 { return Ok(0); }
        let n = (buf.len() as u64).min(avail) as usize;
        self.file.seek(SeekFrom::Start(self.pos))?;
        let got = self.file.read(&mut buf[..n])?;
        self.pos += got as u64;
        Ok(got)
    }
}

impl Seek for Reader {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let new = match to {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::Current(d) => self.pos as i128 + d as i128,
            SeekFrom::End(d) => {
                // Sem tamanho conhecido (HLS) é preciso esperar o fim do download.
                let t0 = Instant::now();
                let total = loop {
                    {
                        let s = self.entry.st.lock();
                        if let Some(t) = s.total { break t; }
                        if let Some(e) = &s.error { return Err(io::Error::new(io::ErrorKind::Other, e.clone())); }
                    }
                    if self.cancel.load(Ordering::Relaxed) { return Err(io::Error::new(io::ErrorKind::Interrupted, "leitura cancelada")); }
                    if t0.elapsed() > READ_IDLE_TIMEOUT * 2 { return Err(io::Error::new(io::ErrorKind::TimedOut, "tamanho desconhecido")); }
                    std::thread::sleep(Duration::from_millis(80));
                };
                total as i128 + d as i128
            }
        };
        if new < 0 { return Err(io::Error::new(io::ErrorKind::InvalidInput, "posição negativa")); }
        self.pos = new as u64;
        Ok(self.pos)
    }
}

pub struct Stats {
    pub bytes: u64,
    pub entries: usize,
    pub limit: u64,
}

pub struct Cache {
    root: PathBuf,
    entries: Mutex<HashMap<String, Arc<Entry>>>,
    limit: AtomicU64,
    pub enabled: AtomicBool,
}

fn hash(key: &str) -> String {
    let d = Sha256::digest(key.as_bytes());
    d.iter().take(12).map(|b| format!("{b:02x}")).collect()
}

enum DlErr { Expired, Net(String) }

impl Cache {
    pub fn open(root: PathBuf, limit_mb: u64) -> Arc<Cache> {
        let _ = fs::create_dir_all(&root);
        let cache = Arc::new(Cache { root, entries: Mutex::new(HashMap::new()), limit: AtomicU64::new(limit_mb * 1024 * 1024), enabled: AtomicBool::new(true) });
        cache.scan();
        cache
    }

    /// Recarrega o que já está em disco de execuções anteriores.
    fn scan(&self) {
        let Ok(dir) = fs::read_dir(&self.root) else { return };
        for f in dir.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
            let Ok(meta) = serde_json::from_slice::<Meta>(&fs::read(&p).unwrap_or_default()) else { continue };
            let file = self.root.join(format!("{}.{}", hash(&meta.key), meta.ext));
            let Ok(md) = fs::metadata(&file) else { let _ = fs::remove_file(&p); continue };
            let have = md.len();
            let complete = meta.complete && meta.total.map_or(true, |t| have >= t);
            let st = EntryState { have, total: if complete { Some(have) } else { meta.total }, complete, error: None, target: 0, running: false, seg_next: meta.seg_next, last_used: meta.last_used };
            let e = Arc::new(Entry { key: meta.key.clone(), path: file, meta_path: p.clone(), ext: meta.ext, bitrate: meta.bitrate, codec: meta.codec, st: Mutex::new(st), cv: Condvar::new(), readers: AtomicUsize::new(0) });
            self.entries.lock().insert(meta.key, e);
        }
    }

    pub fn set_limit_mb(&self, mb: u64) { self.limit.store(mb.saturating_mul(1024 * 1024), Ordering::Relaxed); }
    pub fn limit_bytes(&self) -> u64 { self.limit.load(Ordering::Relaxed) }

    pub fn entry_for(&self, s: &StreamInfo) -> Arc<Entry> {
        let key = format!("{}:{}", s.source, s.source_id);
        let mut map = self.entries.lock();
        if let Some(e) = map.get(&key) {
            // Arquivo apagado por fora: recomeça do zero.
            if !e.path.exists() && e.st.lock().have > 0 {
                let mut st = e.st.lock();
                *st = EntryState { last_used: now_ms(), ..Default::default() };
            }
            return e.clone();
        }
        let h = hash(&key);
        let e = Arc::new(Entry {
            key: key.clone(), path: self.root.join(format!("{h}.{}", s.ext)), meta_path: self.root.join(format!("{h}.json")), ext: s.ext.clone(),
            bitrate: s.bitrate, codec: s.codec.clone(), st: Mutex::new(EntryState { last_used: now_ms(), ..Default::default() }), cv: Condvar::new(), readers: AtomicUsize::new(0),
        });
        let _ = fs::write(&e.path, b""); // o leitor precisa abrir o arquivo mesmo antes do primeiro byte
        map.insert(key, e.clone());
        e
    }

    /// Garante o download até `target` bytes (ou tudo, com `FULL`). Não bloqueia: roda em segundo plano.
    pub fn fetch(self: &Arc<Self>, entry: &Arc<Entry>, stream: StreamInfo, target: u64, refresh: Option<Refresh>) {
        {
            let mut s = entry.st.lock();
            s.error = None;
            s.target = s.target.max(target);
            s.last_used = now_ms();
            if s.complete || s.running { return; }
            s.running = true;
        }
        let (cache, entry) = (self.clone(), entry.clone());
        tauri::async_runtime::spawn(async move { cache.run(entry, stream, refresh).await });
    }

    /// Reduz o objetivo de uma entrada que ninguém mais precisa tocar por inteiro.
    pub fn lower_target(&self, entry: &Arc<Entry>, to: u64) {
        let mut s = entry.st.lock();
        if s.target > to { s.target = to.max(s.have); }
    }

    async fn run(self: Arc<Self>, entry: Arc<Entry>, mut stream: StreamInfo, refresh: Option<Refresh>) {
        let (mut retries, mut refreshed) = (0u32, false);
        loop {
            let (have, seg_next, total) = {
                let mut s = entry.st.lock();
                if s.complete || s.have >= s.target || s.error.is_some() {
                    s.running = false;
                    entry.cv.notify_all();
                    drop(s);
                    entry.persist();
                    self.trim(&HashSet::new());
                    return;
                }
                (s.have, s.seg_next, s.total)
            };
            let step = if stream.segments.is_empty() { self.range_step(&entry, &stream, have, total).await } else { self.segment_step(&entry, &stream, seg_next).await };
            match step {
                Ok(()) => retries = 0,
                Err(DlErr::Expired) if !refreshed && refresh.is_some() => {
                    refreshed = true;
                    match (refresh.as_ref().unwrap())().await {
                        Ok(s) => stream = s,
                        Err(e) => self.fail(&entry, format!("não foi possível renovar a URL: {e}")),
                    }
                }
                Err(DlErr::Expired) => self.fail(&entry, "a URL do áudio expirou".into()),
                Err(DlErr::Net(e)) if retries < MAX_RETRIES => {
                    retries += 1;
                    eprintln!("[cache] {} tentativa {retries}: {e}", entry.key);
                    tokio::time::sleep(Duration::from_millis(400 << retries)).await;
                }
                Err(DlErr::Net(e)) => self.fail(&entry, e),
            }
        }
    }

    fn fail(&self, entry: &Arc<Entry>, msg: String) {
        let mut s = entry.st.lock();
        s.error = Some(msg);
        entry.cv.notify_all();
    }

    fn append(&self, entry: &Arc<Entry>, have_before: u64, bytes: &[u8]) -> Result<(), DlErr> {
        let mut f = fs::OpenOptions::new().create(true).write(true).open(&entry.path).map_err(|e| DlErr::Net(format!("disco: {e}")))?;
        f.set_len(have_before).and_then(|_| f.seek(SeekFrom::Start(have_before))).and_then(|_| f.write_all(bytes)).map_err(|e| DlErr::Net(format!("disco: {e}")))?;
        Ok(())
    }

    async fn range_step(&self, entry: &Arc<Entry>, stream: &StreamInfo, start: u64, total: Option<u64>) -> Result<(), DlErr> {
        let chunk = if start == 0 { FIRST_CHUNK } else { CHUNK };
        let mut end = start + chunk - 1;
        if let Some(t) = total { end = end.min(t.saturating_sub(1)); }
        let mut req = CLIENT.get(&stream.url).header("Range", format!("bytes={start}-{end}"));
        for (k, v) in &stream.headers { req = req.header(k.as_str(), v.as_str()); }
        let resp = req.send().await.map_err(|e| DlErr::Net(e.to_string()))?;
        let status = resp.status().as_u16();
        if matches!(status, 401 | 403 | 404 | 410) { return Err(DlErr::Expired); }
        if status != 206 && status != 200 { return Err(DlErr::Net(format!("HTTP {status}"))); }
        let content_range_total = resp.headers().get("content-range").and_then(|v| v.to_str().ok()).and_then(|v| v.rsplit('/').next()).and_then(|t| t.parse::<u64>().ok());
        let whole_body = status == 200; // o servidor ignorou o Range e mandou o arquivo todo
        if whole_body && start != 0 { return Err(DlErr::Net("o servidor não aceita Range".into())); }
        let bytes = resp.bytes().await.map_err(|e| DlErr::Net(e.to_string()))?;
        if bytes.is_empty() { return Err(DlErr::Net("resposta vazia".into())); }
        self.append(entry, start, &bytes)?;
        let mut s = entry.st.lock();
        s.have = start + bytes.len() as u64;
        if whole_body { s.total = Some(s.have); s.complete = true; }
        else {
            if let Some(t) = content_range_total.or(stream.content_length) { s.total = Some(t); }
            if s.total.map_or(false, |t| s.have >= t) { s.complete = true; }
        }
        entry.cv.notify_all();
        Ok(())
    }

    async fn segment_step(&self, entry: &Arc<Entry>, stream: &StreamInfo, idx: usize) -> Result<(), DlErr> {
        let url = stream.segments.get(idx).ok_or_else(|| DlErr::Net("segmento inexistente".into()))?;
        let mut req = CLIENT.get(url);
        for (k, v) in &stream.headers { req = req.header(k.as_str(), v.as_str()); }
        let resp = req.send().await.map_err(|e| DlErr::Net(e.to_string()))?;
        let status = resp.status().as_u16();
        if matches!(status, 401 | 403 | 404 | 410) { return Err(DlErr::Expired); }
        if !resp.status().is_success() { return Err(DlErr::Net(format!("HTTP {status}"))); }
        let bytes = resp.bytes().await.map_err(|e| DlErr::Net(e.to_string()))?;
        let have = entry.st.lock().have;
        self.append(entry, have, &bytes)?;
        let mut s = entry.st.lock();
        s.have = have + bytes.len() as u64;
        s.seg_next = idx + 1;
        if s.seg_next >= stream.segments.len() { s.total = Some(s.have); s.complete = true; }
        entry.cv.notify_all();
        Ok(())
    }

    pub fn stats(&self) -> Stats {
        let map = self.entries.lock();
        Stats { bytes: map.values().map(|e| e.have()).sum(), entries: map.len(), limit: self.limit_bytes() }
    }

    /// Descarta as entradas usadas há mais tempo até caber no limite. `protect` = chaves que não podem sair.
    pub fn trim(&self, protect: &HashSet<String>) {
        let limit = if self.enabled.load(Ordering::Relaxed) { self.limit_bytes() } else { 0 };
        let mut map = self.entries.lock();
        let mut total: u64 = map.values().map(|e| e.have()).sum();
        if total <= limit { return; }
        let mut victims: Vec<Arc<Entry>> = map.values().filter(|e| !protect.contains(&e.key) && e.readers.load(Ordering::SeqCst) == 0 && !e.st.lock().running).cloned().collect();
        victims.sort_by_key(|e| e.st.lock().last_used);
        for e in victims {
            if total <= limit { break; }
            total = total.saturating_sub(e.have());
            let _ = fs::remove_file(&e.path);
            let _ = fs::remove_file(&e.meta_path);
            map.remove(&e.key);
        }
    }

    pub fn clear(&self, protect: &HashSet<String>) {
        let mut map = self.entries.lock();
        let keys: Vec<String> = map.values().filter(|e| !protect.contains(&e.key) && e.readers.load(Ordering::SeqCst) == 0 && !e.st.lock().running).map(|e| e.key.clone()).collect();
        for k in keys {
            if let Some(e) = map.remove(&k) {
                let _ = fs::remove_file(&e.path);
                let _ = fs::remove_file(&e.meta_path);
            }
        }
    }

    /// Entrada para um arquivo que já existe fora do cache (biblioteca local, downloads). Fica fora do mapa, então
    /// `trim` e `clear` nunca a enxergam: o arquivo do usuário jamais é apagado por aqui.
    pub fn external_entry(&self, s: &StreamInfo) -> Arc<Entry> {
        let path = PathBuf::from(&s.source_id);
        let len = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        Arc::new(Entry {
            key: format!("{}:{}", s.source, s.source_id), path, meta_path: PathBuf::new(), ext: s.ext.clone(), bitrate: s.bitrate, codec: s.codec.clone(),
            st: Mutex::new(EntryState { have: len, total: Some(len), complete: true, last_used: now_ms(), ..Default::default() }), cv: Condvar::new(), readers: AtomicUsize::new(0),
        })
    }

    pub fn get(&self, key: &str) -> Option<Arc<Entry>> { self.entries.lock().get(key).cloned() }
}
