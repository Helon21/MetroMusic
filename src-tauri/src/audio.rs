//! Motor de áudio: decodifica (Symphonia), reamostra para a taxa do dispositivo e toca (cpal).
//!
//! Três partes, em threads separadas:
//!   - a *thread do motor* recebe comandos, é dona do stream do dispositivo e emite posição/estado;
//!   - a *thread de decodificação* (uma por faixa) lê o arquivo do cache, decodifica e enche o buffer;
//!   - o *callback do dispositivo* só consome do buffer (nunca espera nem aloca).

use crate::cache::Reader;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use parking_lot::{Condvar, Mutex};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, sync_channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions};
use symphonia::core::errors::Error as SymErr;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

pub type Emit = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

/// ~1,5 s de áudio estéreo à frente do dispositivo.
const BUFFER_SECONDS: f64 = 1.5;
const POSITION_EVERY: Duration = Duration::from_millis(250);

/// Sem busca nativa de propósito: com `is_seekable() == true` o demuxer MP4 exige o tamanho total e varre
/// o arquivo inteiro antes de começar, o que obrigaria a esperar o download completo (e no HLS o tamanho
/// nem é conhecido). Sem isso ele começa a decodificar logo após o `moov`. A busca é feita por
/// `seek_source`, reabrindo o arquivo em cache.
impl MediaSource for Reader {
    fn is_seekable(&self) -> bool { false }
    fn byte_len(&self) -> Option<u64> { None }
}

type Opener = Box<dyn Fn() -> std::io::Result<Reader> + Send>;

/// O que a interface precisa saber da faixa carregada.
pub struct LoadMeta {
    pub token: u64,
    pub key: String,
    pub source: String,
    pub codec: String,
    pub bitrate: u32,
    pub duration_hint: Option<f64>,
}

enum Cmd {
    Load { open: Opener, ext: String, start: f64, autoplay: bool, cancel: Arc<AtomicBool>, meta: LoadMeta },
    Pause,
    Resume,
    Seek(f64),
    Stop,
    Volume(f32),
    Speed(f32),
}

enum DecCmd { Seek(f64) }

struct Buffer {
    /// Estéreo intercalado, na taxa do dispositivo.
    data: VecDeque<f32>,
    /// O decodificador chegou ao fim da faixa.
    eof: bool,
}

struct Shared {
    buf: Mutex<Buffer>,
    space: Condvar,
    playing: AtomicBool,
    volume: AtomicU32,
    speed: AtomicU32,
    played_frames: AtomicU64,
    /// Posição (s) correspondente a `played_frames == 0`.
    base_pos: AtomicU64,
    finished: AtomicBool,
    underrun: AtomicBool,
}

fn f32_load(a: &AtomicU32) -> f32 { f32::from_bits(a.load(Ordering::Relaxed)) }
fn f64_load(a: &AtomicU64) -> f64 { f64::from_bits(a.load(Ordering::Relaxed)) }

/// Interpolação cúbica (Catmull-Rom) em fluxo, para converter a taxa de amostragem.
struct Resampler {
    ratio: f64,
    t: f64,
    hist: Vec<[f32; 2]>,
}

impl Resampler {
    fn new(ratio: f64) -> Self { Resampler { ratio, t: 1.0, hist: vec![[0.0; 2]] } }
    fn reset(&mut self) { self.t = 1.0; self.hist = vec![[0.0; 2]]; }
    fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if (self.ratio - 1.0).abs() < 1e-9 { out.extend_from_slice(input); return; }
        self.hist.extend(input.chunks_exact(2).map(|f| [f[0], f[1]]));
        while (self.t as usize) + 2 < self.hist.len() {
            let i = self.t as usize;
            let f = (self.t - i as f64) as f32;
            for c in 0..2 {
                let (p0, p1, p2, p3) = (self.hist[i - 1][c], self.hist[i][c], self.hist[i + 1][c], self.hist[i + 2][c]);
                out.push(p1 + 0.5 * f * (p2 - p0 + f * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + f * (3.0 * (p1 - p2) + p3 - p0))));
            }
            self.t += self.ratio;
        }
        let drop = (self.t as usize).saturating_sub(1);
        self.hist.drain(..drop);
        self.t -= drop as f64;
    }
}

pub struct Engine {
    tx: Sender<Cmd>,
    shared: Arc<Shared>,
}

impl Engine {
    /// Abre o dispositivo de saída padrão e inicia a thread do motor.
    pub fn start(emit: Emit) -> Result<Engine, String> {
        let shared = Arc::new(Shared {
            buf: Mutex::new(Buffer { data: VecDeque::new(), eof: false }),
            space: Condvar::new(),
            playing: AtomicBool::new(false),
            volume: AtomicU32::new(0.8f32.to_bits()),
            speed: AtomicU32::new(1.0f32.to_bits()),
            played_frames: AtomicU64::new(0),
            base_pos: AtomicU64::new(0f64.to_bits()),
            finished: AtomicBool::new(false),
            underrun: AtomicBool::new(false),
        });
        let (tx, rx) = channel();
        let (ready_tx, ready_rx) = sync_channel::<Result<(), String>>(1);
        let sh = shared.clone();
        std::thread::Builder::new().name("audio-engine".into()).spawn(move || engine_thread(sh, rx, emit, ready_tx)).map_err(|e| e.to_string())?;
        ready_rx.recv().map_err(|e| e.to_string())??;
        Ok(Engine { tx, shared })
    }

    pub fn load(&self, open: Opener, ext: String, start: f64, autoplay: bool, cancel: Arc<AtomicBool>, meta: LoadMeta) {
        let _ = self.tx.send(Cmd::Load { open, ext, start, autoplay, cancel, meta });
    }
    pub fn pause(&self) { let _ = self.tx.send(Cmd::Pause); }
    pub fn resume(&self) { let _ = self.tx.send(Cmd::Resume); }
    pub fn seek(&self, secs: f64) { let _ = self.tx.send(Cmd::Seek(secs.max(0.0))); }
    pub fn stop(&self) { let _ = self.tx.send(Cmd::Stop); }
    pub fn set_volume(&self, v: f32) { self.shared.volume.store(v.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed); let _ = self.tx.send(Cmd::Volume(v)); }
    pub fn set_speed(&self, s: f32) { let _ = self.tx.send(Cmd::Speed(s.clamp(0.25, 2.0))); }
    pub fn position(&self) -> f64 { position_of(&self.shared, self.shared.played_frames.load(Ordering::Relaxed)) }
}

fn position_of(sh: &Shared, played: u64) -> f64 {
    // `rate` é a do dispositivo e fica registrada em `RATE`; ver `engine_thread`.
    f64_load(&sh.base_pos) + played as f64 / RATE.load(Ordering::Relaxed) as f64 * f32_load(&sh.speed) as f64
}

static RATE: AtomicU32 = AtomicU32::new(48_000);

// ───────── Dispositivo

fn build_stream<T>(device: &cpal::Device, config: &cpal::StreamConfig, sh: Arc<Shared>) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = config.channels as usize;
    let mut scratch: Vec<f32> = Vec::new();
    let (mut gain, mut fade) = (f32_load(&sh.volume), 0.0f32);
    device
        .build_output_stream(
            config,
            move |out: &mut [T], _| {
                let frames = out.len() / channels;
                scratch.clear();
                scratch.resize(out.len(), 0.0);
                let playing = sh.playing.load(Ordering::Relaxed);
                let target_gain = f32_load(&sh.volume);
                if !playing && fade == 0.0 { gain = target_gain; } // parado: acompanha o volume sem rampa
                if playing || fade > 0.0 {
                    if let Some(mut b) = sh.buf.try_lock() {
                        let avail = b.data.len() / 2;
                        let n = frames.min(avail);
                        for i in 0..n {
                            gain += (target_gain - gain) * 0.004;
                            fade = if playing { (fade + 1.0 / 480.0).min(1.0) } else { (fade - 1.0 / 480.0).max(0.0) };
                            let g = gain * fade;
                            let (l, r) = (b.data.pop_front().unwrap_or(0.0) * g, b.data.pop_front().unwrap_or(0.0) * g);
                            let o = &mut scratch[i * channels..(i + 1) * channels];
                            if channels == 1 { o[0] = (l + r) * 0.5 } else { o[0] = l; o[1] = r; }
                        }
                        sh.played_frames.fetch_add(n as u64, Ordering::Relaxed);
                        if n < frames && playing {
                            if b.eof && b.data.is_empty() { sh.finished.store(true, Ordering::Relaxed); }
                            else if !b.eof { sh.underrun.store(true, Ordering::Relaxed); }
                        }
                        drop(b);
                        sh.space.notify_one();
                    }
                }
                for (o, s) in out.iter_mut().zip(scratch.iter()) { *o = T::from_sample(s.clamp(-1.0, 1.0)); }
            },
            |e| eprintln!("[áudio] erro no dispositivo: {e}"),
            None,
        )
        .map_err(|e| format!("não foi possível abrir o dispositivo de áudio: {e}"))
}

fn open_device(sh: Arc<Shared>) -> Result<(cpal::Stream, u32), String> {
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("nenhum dispositivo de saída de áudio encontrado")?;
    let supported = device.default_output_config().map_err(|e| format!("configuração de áudio: {e}"))?;
    let rate = supported.sample_rate().0;
    let config: cpal::StreamConfig = supported.config();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build_stream::<f32>(&device, &config, sh)?,
        SampleFormat::I16 => build_stream::<i16>(&device, &config, sh)?,
        SampleFormat::U16 => build_stream::<u16>(&device, &config, sh)?,
        SampleFormat::I32 => build_stream::<i32>(&device, &config, sh)?,
        other => return Err(format!("formato de amostra não suportado: {other:?}")),
    };
    stream.play().map_err(|e| format!("não foi possível iniciar a saída: {e}"))?;
    Ok((stream, rate))
}

// ───────── Thread do motor

struct Active { cancel: Arc<AtomicBool>, dec_tx: Sender<DecCmd>, meta: LoadMeta, duration: Option<f64> }

fn engine_thread(sh: Arc<Shared>, rx: Receiver<Cmd>, emit: Emit, ready: std::sync::mpsc::SyncSender<Result<(), String>>) {
    let (_stream, rate) = match open_device(sh.clone()) {
        Ok(v) => { let _ = ready.send(Ok(())); v }
        Err(e) => { let _ = ready.send(Err(e)); return; }
    };
    RATE.store(rate, Ordering::Relaxed);
    let mut active: Option<Active> = None;
    let mut last_emit = Instant::now();
    let mut buffering = false;
    let (loaded_tx, loaded_rx) = channel::<(u64, Option<f64>)>();

    loop {
        match rx.recv_timeout(Duration::from_millis(60)) {
            Ok(Cmd::Load { open, ext, start, autoplay, cancel, meta }) => {
                if let Some(a) = active.take() { a.cancel.store(true, Ordering::Relaxed); }
                {
                    let mut b = sh.buf.lock();
                    b.data.clear();
                    b.eof = false;
                }
                sh.finished.store(false, Ordering::Relaxed);
                sh.underrun.store(false, Ordering::Relaxed);
                sh.played_frames.store(0, Ordering::Relaxed);
                sh.base_pos.store(start.to_bits(), Ordering::Relaxed);
                sh.playing.store(autoplay, Ordering::Relaxed);
                let (dec_tx, dec_rx) = channel();
                let speed = f32_load(&sh.speed);
                let (shc, c2, em, ltx, token) = (sh.clone(), cancel.clone(), emit.clone(), loaded_tx.clone(), meta.token);
                let hint = meta.duration_hint;
                std::thread::Builder::new().name("audio-decoder".into()).spawn(move || {
                    if let Err(e) = decode_loop(open, ext, start, shc, rate, speed, c2.clone(), dec_rx, ltx, token, hint) {
                        if !c2.load(Ordering::Relaxed) { em("audio:state", json!({ "token": token, "state": "error", "message": e })); }
                    }
                }).ok();
                emit("audio:state", json!({ "token": meta.token, "state": "buffering" }));
                buffering = true;
                active = Some(Active { cancel, dec_tx, meta, duration: hint });
            }
            Ok(Cmd::Pause) => {
                sh.playing.store(false, Ordering::Relaxed);
                if let Some(a) = &active { emit("audio:state", json!({ "token": a.meta.token, "state": "paused" })); }
            }
            Ok(Cmd::Resume) => {
                if active.is_some() {
                    sh.playing.store(true, Ordering::Relaxed);
                    sh.finished.store(false, Ordering::Relaxed);
                    emit("audio:state", json!({ "token": active.as_ref().unwrap().meta.token, "state": "playing" }));
                }
            }
            Ok(Cmd::Seek(secs)) => {
                if let Some(a) = &active {
                    let secs = a.duration.map_or(secs, |d| secs.min((d - 0.25).max(0.0)));
                    let _ = a.dec_tx.send(DecCmd::Seek(secs));
                    sh.finished.store(false, Ordering::Relaxed);
                }
            }
            Ok(Cmd::Stop) => {
                if let Some(a) = active.take() { a.cancel.store(true, Ordering::Relaxed); }
                sh.playing.store(false, Ordering::Relaxed);
                let mut b = sh.buf.lock();
                b.data.clear();
            }
            Ok(Cmd::Volume(_)) => {}
            Ok(Cmd::Speed(s)) => {
                let pos = position_of(&sh, sh.played_frames.load(Ordering::Relaxed));
                sh.speed.store(s.to_bits(), Ordering::Relaxed);
                if let Some(a) = &active { let _ = a.dec_tx.send(DecCmd::Seek(pos)); }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        while let Ok((token, dur)) = loaded_rx.try_recv() {
            if let Some(a) = active.as_mut().filter(|a| a.meta.token == token) {
                a.duration = dur.or(a.duration);
                emit("audio:loaded", json!({ "token": token, "key": a.meta.key, "source": a.meta.source, "codec": a.meta.codec, "bitrate": a.meta.bitrate, "duration": a.duration }));
            }
        }

        let Some(a) = &active else { continue };
        let playing = sh.playing.load(Ordering::Relaxed);
        if sh.underrun.swap(false, Ordering::Relaxed) && !buffering && playing {
            buffering = true;
            emit("audio:state", json!({ "token": a.meta.token, "state": "buffering" }));
        }
        if buffering && playing && sh.buf.lock().data.len() > (rate as usize / 4) * 2 {
            buffering = false;
            emit("audio:state", json!({ "token": a.meta.token, "state": "playing" }));
        }
        if sh.finished.swap(false, Ordering::Relaxed) {
            sh.playing.store(false, Ordering::Relaxed);
            emit("audio:ended", json!({ "token": a.meta.token, "key": a.meta.key }));
            continue;
        }
        if playing && last_emit.elapsed() >= POSITION_EVERY {
            last_emit = Instant::now();
            let pos = position_of(&sh, sh.played_frames.load(Ordering::Relaxed));
            emit("audio:position", json!({ "token": a.meta.token, "position": pos, "duration": a.duration }));
        }
    }
}

// ───────── Thread de decodificação

struct Source {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    src_rate: u32,
    time_base: Option<symphonia::core::units::TimeBase>,
    duration: Option<f64>,
}

impl Source {
    fn secs(&self, ts: u64) -> f64 {
        self.time_base.map(|tb| { let t = tb.calc_time(ts); t.seconds as f64 + t.frac }).unwrap_or(ts as f64 / self.src_rate as f64)
    }
}

fn open_source(open: &Opener, ext: &str) -> Result<Source, String> {
    let reader = open().map_err(|e| format!("não foi possível abrir o arquivo em cache: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(reader), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(ext);
    let probed = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()).map_err(|e| format!("formato de áudio não reconhecido: {e}"))?;
    let format = probed.format;
    let track = format.default_track().ok_or("o arquivo não tem faixa de áudio")?.clone();
    let decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default()).map_err(|e| format!("codec não suportado: {e}"))?;
    let src_rate = track.codec_params.sample_rate.ok_or("taxa de amostragem desconhecida")?;
    // MP4 fragmentado costuma declarar 0 quadros no `moov`: nesse caso a duração é desconhecida.
    let duration = track.codec_params.n_frames.filter(|n| *n > 0).map(|n| n as f64 / src_rate as f64);
    Ok(Source { format, decoder, track_id: track.id, src_rate, time_base: track.codec_params.time_base, duration })
}

/// Posiciona uma fonte recém-aberta em `target` s: pula pacotes sem decodificar e devolve o pacote
/// anterior (para aquecer o decodificador) e o primeiro que contém o ponto pedido.
fn seek_source(src: &mut Source, target: f64, cancel: &AtomicBool) -> Result<(Option<symphonia::core::formats::Packet>, symphonia::core::formats::Packet), String> {
    let mut prev = None;
    loop {
        if cancel.load(Ordering::Relaxed) { return Err("cancelado".into()); }
        let p = src.format.next_packet().map_err(|e| format!("busca: {e}"))?;
        if p.track_id() != src.track_id { continue; }
        if src.secs(p.ts() + p.dur()) > target { return Ok((prev, p)); }
        prev = Some(p);
    }
}

fn decode_loop(
    open: Opener, ext: String, start: f64, sh: Arc<Shared>, rate: u32, speed: f32,
    cancel: Arc<AtomicBool>, cmds: Receiver<DecCmd>, loaded: Sender<(u64, Option<f64>)>, token: u64, hint_duration: Option<f64>,
) -> Result<(), String> {
    let mut src = open_source(&open, &ext)?;
    let _ = loaded.send((token, src.duration.or(hint_duration)));
    // Quadros de entrada consumidos por quadro de saída; com velocidade > 1 consome mais entrada.
    let mut resampler = Resampler::new((src.src_rate as f64 * speed as f64) / rate as f64);
    let cap = (rate as f64 * BUFFER_SECONDS) as usize * 2;
    let mut sbuf: Option<SampleBuffer<f32>> = None;
    let (mut out, mut stereo): (Vec<f32>, Vec<f32>) = (Vec::new(), Vec::new());
    let (mut eof, mut skip_until): (bool, Option<f64>) = (false, None);
    let mut queued: std::collections::VecDeque<symphonia::core::formats::Packet> = Default::default();

    // Posiciona em `t`: reabre o arquivo, pula pacotes e zera o buffer de saída.
    macro_rules! reposition {
        ($t:expr) => {{
            let t: f64 = $t;
            src = open_source(&open, &ext)?;
            resampler.reset();
            resampler.ratio = (src.src_rate as f64 * f32_load(&sh.speed) as f64) / rate as f64;
            queued.clear();
            if t > 0.05 {
                let (prev, first) = seek_source(&mut src, t, &cancel)?;
                queued.extend(prev);
                queued.push_back(first);
                skip_until = Some(t);
            } else { skip_until = None; }
            {
                let mut b = sh.buf.lock();
                b.data.clear();
                b.eof = false;
            }
            sh.played_frames.store(0, Ordering::Relaxed);
            sh.base_pos.store(t.to_bits(), Ordering::Relaxed);
            sh.finished.store(false, Ordering::Relaxed);
            eof = false;
        }};
    }

    if start > 0.05 { reposition!(start); }

    loop {
        if cancel.load(Ordering::Relaxed) { return Ok(()); }
        let mut seek_to = None;
        while let Ok(DecCmd::Seek(t)) = cmds.try_recv() { seek_to = Some(t); }
        if let Some(t) = seek_to { reposition!(t); }
        if eof { std::thread::sleep(Duration::from_millis(40)); continue; }
        {
            let mut b = sh.buf.lock();
            if b.data.len() >= cap { sh.space.wait_for(&mut b, Duration::from_millis(40)); continue; }
        }
        let packet = match queued.pop_front() {
            Some(p) => p,
            None => match src.format.next_packet() {
                Ok(p) => p,
                Err(SymErr::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => { sh.buf.lock().eof = true; eof = true; continue; }
                Err(SymErr::IoError(_)) if cancel.load(Ordering::Relaxed) => return Ok(()),
                Err(SymErr::ResetRequired) => { src.decoder.reset(); continue; }
                Err(e) => return Err(format!("leitura do áudio: {e}")),
            },
        };
        if packet.track_id() != src.track_id { continue; }
        let t0 = src.secs(packet.ts());
        let decoded = match src.decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymErr::DecodeError(_)) | Err(SymErr::IoError(_)) => continue, // pacote ruim: pula
            Err(e) => return Err(format!("decodificação: {e}")),
        };
        let spec = *decoded.spec();
        if sbuf.as_ref().map_or(true, |s| s.capacity() < decoded.capacity() * spec.channels.count()) {
            sbuf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
        }
        let sb = sbuf.as_mut().unwrap();
        sb.copy_interleaved_ref(decoded);
        let ch = spec.channels.count().max(1);
        let mut frames: Vec<[f32; 2]> = sb.samples().chunks_exact(ch).map(|f| if ch == 1 { [f[0], f[0]] } else { [f[0], f[1]] }).collect();
        // depois de uma busca, descarta o que vem antes do ponto pedido (inclusive o pacote de aquecimento)
        if let Some(target) = skip_until {
            let n = frames.len();
            let drop = (((target - t0) * src.src_rate as f64).round().max(0.0) as usize).min(n);
            frames.drain(..drop);
            if t0 + n as f64 / src.src_rate as f64 > target { skip_until = None; }
        }
        if frames.is_empty() { continue; }
        stereo.clear();
        stereo.extend(frames.iter().flat_map(|f| f.iter().copied()));
        out.clear();
        resampler.process(&stereo, &mut out);
        sh.buf.lock().data.extend(out.iter().copied());
    }
}
