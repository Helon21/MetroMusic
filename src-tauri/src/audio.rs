//! Motor de áudio: decodifica (Symphonia), reamostra para a taxa do dispositivo e toca (cpal).
//!
//! Três partes, em threads separadas:
//!   - a *thread do motor* recebe comandos, é dona do stream do dispositivo e emite posição/estado;
//!   - a *thread de decodificação* (uma por faixa) lê o arquivo do cache, decodifica e enche um dos dois
//!     buffers (*slots*): o da faixa que toca e o da próxima, já pré-carregada;
//!   - o *callback do dispositivo* consome dos buffers (nunca espera nem aloca) e aplica, em ordem:
//!     mixagem da transição (crossfade ou emenda sem pausa) → equalizador → ganho (normalização, volume, fade).

use crate::cache::Reader;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use parking_lot::{Condvar, Mutex};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, sync_channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions};
use symphonia::core::errors::Error as SymErr;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

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

/// O que a interface precisa saber da faixa carregada.
pub struct LoadMeta {
    pub token: u64,
    pub key: String,
    pub source: String,
    pub codec: String,
    pub bitrate: u32,
    pub duration_hint: Option<f64>,
    /// Loudness informado pelo serviço (LUFS). Sem ele, o motor mede enquanto decodifica.
    pub loudness: Option<f64>,
}

enum Cmd {
    Load { open: Opener, ext: String, start: f64, autoplay: bool, cancel: Arc<AtomicBool>, meta: LoadMeta },
    Next { open: Opener, ext: String, cancel: Arc<AtomicBool>, meta: LoadMeta, gapless_pair: bool },
    ClearNext,
    Advance,
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

/// Um dos dois buffers: o da faixa que toca ou o da próxima.
struct Slot {
    buf: Mutex<Buffer>,
    space: Condvar,
    /// Loudness da faixa deste slot (LUFS, f64 em bits; NaN = ainda desconhecido).
    lufs: AtomicU64,
    /// Bitrate medido do que foi decodificado há pouco (bits/s; 0 = ainda sem medida).
    live_bitrate: AtomicU32,
}

/// Mede o bitrate real do arquivo: bytes lidos / tempo de áudio, em janelas de 1 s (útil em FLAC e outros de taxa variável).
struct LiveRate { bytes: u64, secs: f64 }
impl LiveRate {
    fn new() -> Self { LiveRate { bytes: 0, secs: 0.0 } }
    /// Soma um pacote (`bytes` do arquivo, `frames` de áudio na taxa `src_rate`). Devolve bits/s ao fechar cada janela.
    fn push(&mut self, bytes: usize, frames: usize, src_rate: u32) -> Option<u32> {
        if src_rate == 0 { return None; }
        self.bytes += bytes as u64;
        self.secs += frames as f64 / src_rate as f64;
        if self.secs < 1.0 { return None; }
        let bps = (self.bytes as f64 * 8.0 / self.secs).round() as u32;
        *self = LiveRate::new();
        Some(bps)
    }
}

impl Slot {
    fn new() -> Slot { Slot { buf: Mutex::new(Buffer { data: VecDeque::new(), eof: false }), space: Condvar::new(), lufs: AtomicU64::new(f64::NAN.to_bits()), live_bitrate: AtomicU32::new(0) } }
    fn reset(&self, lufs: Option<f64>) {
        let mut b = self.buf.lock();
        b.data.clear();
        b.eof = false;
        self.lufs.store(lufs.unwrap_or(f64::NAN).to_bits(), Ordering::Relaxed);
        self.live_bitrate.store(0, Ordering::Relaxed);
    }
}

const EQ_BANDS: usize = 10;
const EQ_FREQS: [f32; EQ_BANDS] = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
/// Largura de cada faixa do equalizador gráfico de 10 bandas (uma oitava).
const EQ_Q: f32 = 1.41;
/// Limites do ganho de normalização, como no MetroFuse (−24 dB a +6 dB).
const NORM_MIN_DB: f32 = -24.0;
const NORM_MAX_DB: f32 = 6.0;

struct Shared {
    slots: [Slot; 2],
    /// Índice do slot que toca agora.
    cur: AtomicUsize,
    playing: AtomicBool,
    volume: AtomicU32,
    speed: AtomicU32,
    played_frames: AtomicU64,
    /// Posição (s) correspondente a `played_frames == 0`.
    base_pos: AtomicU64,
    finished: AtomicBool,
    underrun: AtomicBool,
    // equalizador
    eq_on: AtomicBool,
    eq_gains: [AtomicU32; EQ_BANDS],
    eq_pre: AtomicU32,
    eq_ver: AtomicU32,
    // normalização
    norm_on: AtomicBool,
    norm_target: AtomicU32,
    // transição entre faixas
    xf_secs: AtomicU32,
    /// Há uma próxima faixa carregada no outro slot (a emenda sem pausa é permitida).
    next_armed: AtomicBool,
    xf_active: AtomicBool,
    xf_total: AtomicU64,
    xf_done: AtomicU64,
    /// O callback trocou de faixa; a thread do motor ainda precisa avisar a interface.
    swapped: AtomicBool,
}

fn f32_load(a: &AtomicU32) -> f32 { f32::from_bits(a.load(Ordering::Relaxed)) }
fn f64_load(a: &AtomicU64) -> f64 { f64::from_bits(a.load(Ordering::Relaxed)) }

// ───────── Equalizador

#[derive(Clone, Copy)]
struct Biquad { b0: f32, b1: f32, b2: f32, a1: f32, a2: f32 }

impl Biquad {
    const IDENTITY: Biquad = Biquad { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };
    /// Filtro "peaking" (receita do Audio EQ Cookbook, de Robert Bristow-Johnson).
    fn peaking(freq: f32, gain_db: f32, q: f32, fs: f32) -> Biquad {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq / fs;
        let (sw, cw) = (w0.sin(), w0.cos());
        let alpha = sw / (2.0 * q);
        let a0 = 1.0 + alpha / a;
        Biquad { b0: (1.0 + alpha * a) / a0, b1: (-2.0 * cw) / a0, b2: (1.0 - alpha * a) / a0, a1: (-2.0 * cw) / a0, a2: (1.0 - alpha / a) / a0 }
    }
}

struct Eq {
    ver: u32,
    on: bool,
    pre: f32,
    coef: [Biquad; EQ_BANDS],
    active: [bool; EQ_BANDS],
    /// Estado de cada filtro (forma transposta II): [canal][banda] -> [z1, z2]
    z: [[[f32; 2]; EQ_BANDS]; 2],
}

impl Eq {
    fn new() -> Eq { Eq { ver: u32::MAX, on: false, pre: 1.0, coef: [Biquad::IDENTITY; EQ_BANDS], active: [false; EQ_BANDS], z: [[[0.0; 2]; EQ_BANDS]; 2] } }
    fn refresh(&mut self, sh: &Shared, fs: f32) {
        self.ver = sh.eq_ver.load(Ordering::Relaxed);
        self.on = sh.eq_on.load(Ordering::Relaxed);
        self.pre = 10f32.powf(f32_load(&sh.eq_pre) / 20.0);
        for i in 0..EQ_BANDS {
            let g = f32_load(&sh.eq_gains[i]);
            self.active[i] = g.abs() >= 0.05 && EQ_FREQS[i] < fs * 0.45;
            self.coef[i] = if self.active[i] { Biquad::peaking(EQ_FREQS[i], g, EQ_Q, fs) } else { Biquad::IDENTITY };
        }
    }
    #[inline]
    fn process(&mut self, ch: usize, x: f32) -> f32 {
        if !self.on { return x; }
        let mut y = x * self.pre;
        for i in 0..EQ_BANDS {
            if !self.active[i] { continue; }
            let c = self.coef[i];
            let z = &mut self.z[ch][i];
            let out = c.b0 * y + z[0];
            z[0] = c.b1 * y - c.a1 * out + z[1];
            z[1] = c.b2 * y - c.a2 * out;
            y = out;
        }
        y
    }
}

// ───────── Medidor de loudness (ITU-R BS.1770: ponderação K, blocos de 400 ms, duas portas)

struct Meter {
    f1: [f64; 5],
    f2: [f64; 5],
    z: [[[f64; 2]; 2]; 2],
    acc: f64,
    n: usize,
    block: usize,
    blocks: Vec<f64>,
}

impl Meter {
    fn new(fs: f64) -> Meter {
        use std::f64::consts::PI;
        // estágio 1: prateleira de agudos
        let (g, f0, q) = (3.999843853973347f64, 1681.9744509555319f64, 0.7071752369554196f64);
        let k = (PI * f0 / fs).tan();
        let vh = 10f64.powf(g / 20.0);
        let vb = vh.powf(0.4996667741545416);
        let a0 = 1.0 + k / q + k * k;
        let f1 = [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0];
        // estágio 2: passa-altas (curva RLB)
        let (f0, q) = (38.13547087602444f64, 0.5003270373238773f64);
        let k = (PI * f0 / fs).tan();
        let a0 = 1.0 + k / q + k * k;
        let f2 = [1.0, -2.0, 1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0];
        Meter { f1, f2, z: [[[0.0; 2]; 2]; 2], acc: 0.0, n: 0, block: (0.4 * fs) as usize, blocks: vec![] }
    }
    fn stage(c: &[f64; 5], z: &mut [f64; 2], x: f64) -> f64 {
        let y = c[0] * x + z[0];
        z[0] = c[1] * x - c[3] * y + z[1];
        z[1] = c[2] * x - c[4] * y;
        y
    }
    /// Alimenta com estéreo intercalado; `true` se fechou algum bloco.
    fn push(&mut self, samples: &[f32]) -> bool {
        let mut closed = false;
        for fr in samples.chunks_exact(2) {
            let mut p = 0.0;
            for ch in 0..2 {
                let y = Self::stage(&self.f1, &mut self.z[ch][0], fr[ch] as f64);
                let y = Self::stage(&self.f2, &mut self.z[ch][1], y);
                p += y * y;
            }
            self.acc += p;
            self.n += 1;
            if self.n >= self.block {
                if self.blocks.len() < 400 { self.blocks.push(self.acc / self.n as f64); }
                self.acc = 0.0;
                self.n = 0;
                closed = true;
            }
        }
        closed
    }
    /// Loudness integrado (LUFS) com a porta absoluta de −70 e a relativa de −10 LU.
    fn lufs(&self) -> Option<f64> {
        let l = |z: f64| -0.691 + 10.0 * z.max(1e-12).log10();
        let above: Vec<f64> = self.blocks.iter().copied().filter(|z| l(*z) > -70.0).collect();
        if above.len() < 3 { return None; } // menos de ~1,2 s de som: ainda não dá para medir
        let rel = l(above.iter().sum::<f64>() / above.len() as f64) - 10.0;
        let kept: Vec<f64> = above.into_iter().filter(|z| l(*z) > rel).collect();
        if kept.is_empty() { return None; }
        Some(l(kept.iter().sum::<f64>() / kept.len() as f64))
    }
}

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
            slots: [Slot::new(), Slot::new()],
            cur: AtomicUsize::new(0),
            playing: AtomicBool::new(false),
            volume: AtomicU32::new(0.8f32.to_bits()),
            speed: AtomicU32::new(1.0f32.to_bits()),
            played_frames: AtomicU64::new(0),
            base_pos: AtomicU64::new(0f64.to_bits()),
            finished: AtomicBool::new(false),
            underrun: AtomicBool::new(false),
            eq_on: AtomicBool::new(false),
            eq_gains: std::array::from_fn(|_| AtomicU32::new(0f32.to_bits())),
            eq_pre: AtomicU32::new(0f32.to_bits()),
            eq_ver: AtomicU32::new(0),
            norm_on: AtomicBool::new(false),
            norm_target: AtomicU32::new((-14f32).to_bits()),
            xf_secs: AtomicU32::new(0f32.to_bits()),
            next_armed: AtomicBool::new(false),
            xf_active: AtomicBool::new(false),
            xf_total: AtomicU64::new(0),
            xf_done: AtomicU64::new(0),
            swapped: AtomicBool::new(false),
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
    /// Carrega a próxima faixa no segundo buffer: a transição acontece sozinha no fim da atual.
    /// `gapless_pair`: as duas formam um álbum contínuo, então a emenda é sem crossfade.
    pub fn preload(&self, open: Opener, ext: String, cancel: Arc<AtomicBool>, meta: LoadMeta, gapless_pair: bool) {
        let _ = self.tx.send(Cmd::Next { open, ext, cancel, meta, gapless_pair });
    }
    pub fn clear_next(&self) { let _ = self.tx.send(Cmd::ClearNext); }
    /// Passa já para a faixa pré-carregada (botão "próxima"), com um fade curto.
    pub fn advance(&self) { let _ = self.tx.send(Cmd::Advance); }
    pub fn pause(&self) { let _ = self.tx.send(Cmd::Pause); }
    pub fn resume(&self) { let _ = self.tx.send(Cmd::Resume); }
    pub fn seek(&self, secs: f64) { let _ = self.tx.send(Cmd::Seek(secs.max(0.0))); }
    pub fn stop(&self) { let _ = self.tx.send(Cmd::Stop); }
    pub fn set_volume(&self, v: f32) { self.shared.volume.store(v.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed); let _ = self.tx.send(Cmd::Volume(v)); }
    pub fn set_speed(&self, s: f32) { let _ = self.tx.send(Cmd::Speed(s.clamp(0.25, 2.0))); }
    pub fn set_eq(&self, on: bool, gains: &[f32], preamp: f32) {
        for (i, a) in self.shared.eq_gains.iter().enumerate() { a.store(gains.get(i).copied().unwrap_or(0.0).clamp(-24.0, 24.0).to_bits(), Ordering::Relaxed); }
        self.shared.eq_pre.store(preamp.clamp(-24.0, 12.0).to_bits(), Ordering::Relaxed);
        self.shared.eq_on.store(on, Ordering::Relaxed);
        self.shared.eq_ver.fetch_add(1, Ordering::Relaxed);
    }
    /// Normalização de volume: `target` em LUFS (−14 é o padrão do streaming).
    pub fn set_normalization(&self, on: bool, target: f32) {
        self.shared.norm_target.store(target.clamp(-30.0, 0.0).to_bits(), Ordering::Relaxed);
        self.shared.norm_on.store(on, Ordering::Relaxed);
    }
    /// Duração do crossfade em segundos (0 = só emenda sem pausa).
    pub fn set_crossfade(&self, secs: f32) { self.shared.xf_secs.store(secs.clamp(0.0, 12.0).to_bits(), Ordering::Relaxed); }
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
    let fs = config.sample_rate.0 as f32;
    let mut scratch: Vec<f32> = Vec::new();
    let (mut gain, mut fade) = (f32_load(&sh.volume), 0.0f32);
    let mut ng = [1.0f32; 2]; // ganho de normalização suavizado de cada slot
    let mut eq = Eq::new();
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
                if eq.ver != sh.eq_ver.load(Ordering::Relaxed) { eq.refresh(&sh, fs); }
                if playing || fade > 0.0 {
                    let (mut ia, mut ib) = (sh.cur.load(Ordering::Relaxed), 1 - sh.cur.load(Ordering::Relaxed));
                    let mut a = sh.slots[ia].buf.try_lock();
                    let armed = sh.next_armed.load(Ordering::Relaxed);
                    let mut xf_now = sh.xf_active.load(Ordering::Relaxed);
                    let mut b = if xf_now || armed { sh.slots[ib].buf.try_lock() } else { None };
                    if a.is_some() {
                        let (norm_on, norm_target) = (sh.norm_on.load(Ordering::Relaxed), f32_load(&sh.norm_target));
                        let want = |slot: usize| -> f32 {
                            if !norm_on { return 1.0; }
                            let l = f64_load(&sh.slots[slot].lufs) as f32;
                            if l.is_nan() { 1.0 } else { 10f32.powf((norm_target - l).clamp(NORM_MIN_DB, NORM_MAX_DB) / 20.0) }
                        };
                        let (mut wa, mut wb) = (want(ia), want(ib));
                        let (mut xf_done, xf_total) = (sh.xf_done.load(Ordering::Relaxed), sh.xf_total.load(Ordering::Relaxed));
                        let (mut consumed, mut played_base, mut swapped, mut armed_l) = (0u64, 0u64, false, armed);
                        for i in 0..frames {
                            gain += (target_gain - gain) * 0.004;
                            fade = if playing { (fade + 1.0 / 480.0).min(1.0) } else { (fade - 1.0 / 480.0).max(0.0) };
                            ng[ia] += (wa - ng[ia]) * 0.0001;
                            ng[ib] += (wb - ng[ib]) * 0.0001;
                            // fim da faixa sem crossfade: emenda sem silêncio com a próxima, se já estiver pronta
                            if !xf_now && armed_l {
                                let a_dry = a.as_ref().map_or(true, |g| g.data.len() < 2 && g.eof);
                                let b_ready = b.as_ref().map_or(false, |g| g.data.len() >= 2);
                                if a_dry && b_ready {
                                    std::mem::swap(&mut a, &mut b); std::mem::swap(&mut ia, &mut ib); std::mem::swap(&mut wa, &mut wb);
                                    swapped = true; played_base = 0; consumed = 0; armed_l = false;
                                }
                            }
                            let (mut l, mut r) = (0.0f32, 0.0f32);
                            if let Some(g) = a.as_mut() {
                                if g.data.len() >= 2 { l = g.data.pop_front().unwrap_or(0.0) * ng[ia]; r = g.data.pop_front().unwrap_or(0.0) * ng[ia]; consumed += 1; }
                            }
                            if xf_now {
                                let (mut nl, mut nr) = (0.0f32, 0.0f32);
                                if let Some(g) = b.as_mut() {
                                    if g.data.len() >= 2 { nl = g.data.pop_front().unwrap_or(0.0) * ng[ib]; nr = g.data.pop_front().unwrap_or(0.0) * ng[ib]; }
                                }
                                // potência constante: a soma das energias fica igual do começo ao fim
                                let t = (xf_done as f32 / xf_total.max(1) as f32).min(1.0) * std::f32::consts::FRAC_PI_2;
                                let (c, s) = (t.cos(), t.sin());
                                l = l * c + nl * s;
                                r = r * c + nr * s;
                                xf_done += 1;
                                if xf_done >= xf_total {
                                    std::mem::swap(&mut a, &mut b); std::mem::swap(&mut ia, &mut ib); std::mem::swap(&mut wa, &mut wb);
                                    swapped = true; played_base = xf_done; consumed = 0; xf_now = false; armed_l = false;
                                }
                            }
                            let (l, r) = (eq.process(0, l), eq.process(1, r));
                            let g = gain * fade;
                            let (l, r) = (soft_clip(l * g), soft_clip(r * g));
                            let o = &mut scratch[i * channels..(i + 1) * channels];
                            if channels == 1 { o[0] = (l + r) * 0.5 } else { o[0] = l; o[1] = r; }
                        }
                        if swapped {
                            sh.cur.store(ia, Ordering::Relaxed);
                            sh.played_frames.store(played_base + consumed, Ordering::Relaxed);
                            sh.base_pos.store(0f64.to_bits(), Ordering::Relaxed);
                            sh.xf_active.store(false, Ordering::Relaxed);
                            sh.next_armed.store(false, Ordering::Relaxed);
                            sh.xf_done.store(0, Ordering::Relaxed);
                            sh.finished.store(false, Ordering::Relaxed);
                            if let Some(g) = b.as_mut() { g.data.clear(); g.eof = false; } // o que sobrou da faixa antiga
                            sh.swapped.store(true, Ordering::Relaxed);
                        } else {
                            sh.played_frames.fetch_add(consumed, Ordering::Relaxed);
                            sh.xf_done.store(xf_done, Ordering::Relaxed);
                        }
                        if let Some(g) = a.as_ref() {
                            if (consumed as usize) < frames && playing && !swapped {
                                if g.eof && g.data.is_empty() { sh.finished.store(true, Ordering::Relaxed); }
                                else if !g.eof { sh.underrun.store(true, Ordering::Relaxed); }
                            }
                        }
                    }
                    drop(a);
                    drop(b);
                    sh.slots[0].space.notify_one();
                    sh.slots[1].space.notify_one();
                }
                for (o, s) in out.iter_mut().zip(scratch.iter()) { *o = T::from_sample(s.clamp(-1.0, 1.0)); }
            },
            |e| eprintln!("[áudio] erro no dispositivo: {e}"),
            None,
        )
        .map_err(|e| format!("não foi possível abrir o dispositivo de áudio: {e}"))
}

/// Limitador suave: abaixo de 0,9 não mexe; acima, curva as amplitudes até 1,0 em vez de cortar (evita estalo com ganho positivo).
#[inline]
fn soft_clip(x: f32) -> f32 {
    const KNEE: f32 = 0.9;
    let a = x.abs();
    if a <= KNEE { x } else { x.signum() * (KNEE + (1.0 - KNEE) * ((a - KNEE) / (1.0 - KNEE)).tanh()) }
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
struct Pending { cancel: Arc<AtomicBool>, dec_tx: Sender<DecCmd>, meta: LoadMeta, duration: Option<f64>, slot: usize, gapless_pair: bool }

fn engine_thread(sh: Arc<Shared>, rx: Receiver<Cmd>, emit: Emit, ready: std::sync::mpsc::SyncSender<Result<(), String>>) {
    let (_stream, rate) = match open_device(sh.clone()) {
        Ok(v) => { let _ = ready.send(Ok(())); v }
        Err(e) => { let _ = ready.send(Err(e)); return; }
    };
    RATE.store(rate, Ordering::Relaxed);
    let mut active: Option<Active> = None;
    let mut pending: Option<Pending> = None;
    let mut last_emit = Instant::now();
    let mut buffering = false;
    let (loaded_tx, loaded_rx) = channel::<(u64, Option<f64>)>();

    // Sobe um decodificador para `slot`; devolve o canal de comandos dele.
    let spawn_decoder = |open: Opener, ext: String, start: f64, slot: usize, is_next: bool, measure: bool, cancel: Arc<AtomicBool>, token: u64, hint: Option<f64>, loaded: Sender<(u64, Option<f64>)>| -> Sender<DecCmd> {
        let (dec_tx, dec_rx) = channel();
        let (shc, c2, em) = (sh.clone(), cancel, emit.clone());
        std::thread::Builder::new().name("audio-decoder".into()).spawn(move || {
            if let Err(e) = decode_loop(open, ext, start, shc, rate, slot, is_next, measure, c2.clone(), dec_rx, loaded, token, hint) {
                if !c2.load(Ordering::Relaxed) { em("audio:state", json!({ "token": token, "state": "error", "message": e })); }
            }
        }).ok();
        dec_tx
    };

    loop {
        match rx.recv_timeout(Duration::from_millis(60)) {
            Ok(Cmd::Load { open, ext, start, autoplay, cancel, meta }) => {
                if let Some(a) = active.take() { a.cancel.store(true, Ordering::Relaxed); }
                if let Some(p) = pending.take() { p.cancel.store(true, Ordering::Relaxed); }
                sh.next_armed.store(false, Ordering::Relaxed);
                sh.xf_active.store(false, Ordering::Relaxed);
                sh.xf_done.store(0, Ordering::Relaxed);
                sh.cur.store(0, Ordering::Relaxed);
                sh.slots[0].reset(meta.loudness);
                sh.slots[1].reset(None);
                sh.finished.store(false, Ordering::Relaxed);
                sh.underrun.store(false, Ordering::Relaxed);
                sh.swapped.store(false, Ordering::Relaxed);
                sh.played_frames.store(0, Ordering::Relaxed);
                sh.base_pos.store(start.to_bits(), Ordering::Relaxed);
                sh.playing.store(autoplay, Ordering::Relaxed);
                let hint = meta.duration_hint;
                let dec_tx = spawn_decoder(open, ext, start, 0, false, meta.loudness.is_none(), cancel.clone(), meta.token, hint, loaded_tx.clone());
                emit("audio:state", json!({ "token": meta.token, "state": "buffering" }));
                buffering = true;
                active = Some(Active { cancel, dec_tx, meta, duration: hint });
            }
            Ok(Cmd::Next { open, ext, cancel, meta, gapless_pair }) => {
                if active.is_none() { cancel.store(true, Ordering::Relaxed); continue; }
                if let Some(p) = pending.take() { p.cancel.store(true, Ordering::Relaxed); }
                sh.xf_active.store(false, Ordering::Relaxed);
                let slot = 1 - sh.cur.load(Ordering::Relaxed);
                sh.slots[slot].reset(meta.loudness);
                let hint = meta.duration_hint;
                let dec_tx = spawn_decoder(open, ext, 0.0, slot, true, meta.loudness.is_none(), cancel.clone(), meta.token, hint, loaded_tx.clone());
                sh.next_armed.store(true, Ordering::Relaxed);
                pending = Some(Pending { cancel, dec_tx, meta, duration: hint, slot, gapless_pair });
            }
            Ok(Cmd::ClearNext) => {
                if let Some(p) = pending.take() { p.cancel.store(true, Ordering::Relaxed); sh.next_armed.store(false, Ordering::Relaxed); sh.xf_active.store(false, Ordering::Relaxed); sh.slots[p.slot].reset(None); }
            }
            Ok(Cmd::Advance) => {
                if let (Some(p), false) = (&pending, sh.xf_active.load(Ordering::Relaxed)) {
                    if sh.slots[p.slot].buf.lock().data.len() >= (rate as usize / 10) * 2 {
                        sh.xf_total.store((rate as f64 * 0.25) as u64, Ordering::Relaxed);
                        sh.xf_done.store(0, Ordering::Relaxed);
                        sh.xf_active.store(true, Ordering::Relaxed);
                        sh.playing.store(true, Ordering::Relaxed);
                    }
                }
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
                    sh.xf_active.store(false, Ordering::Relaxed); // buscar no meio de uma transição a cancela
                    let secs = a.duration.map_or(secs, |d| secs.min((d - 0.25).max(0.0)));
                    let _ = a.dec_tx.send(DecCmd::Seek(secs));
                    sh.finished.store(false, Ordering::Relaxed);
                }
            }
            Ok(Cmd::Stop) => {
                if let Some(a) = active.take() { a.cancel.store(true, Ordering::Relaxed); }
                if let Some(p) = pending.take() { p.cancel.store(true, Ordering::Relaxed); }
                sh.next_armed.store(false, Ordering::Relaxed);
                sh.xf_active.store(false, Ordering::Relaxed);
                sh.playing.store(false, Ordering::Relaxed);
                sh.slots[0].reset(None);
                sh.slots[1].reset(None);
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
            } else if let Some(p) = pending.as_mut().filter(|p| p.meta.token == token) {
                p.duration = dur.or(p.duration);
            }
        }

        // o callback trocou de faixa (crossfade terminou ou emenda sem pausa): a próxima passou a ser a atual
        if sh.swapped.swap(false, Ordering::Relaxed) {
            if let Some(p) = pending.take() {
                if let Some(old) = active.take() { old.cancel.store(true, Ordering::Relaxed); }
                emit("audio:advanced", json!({ "token": p.meta.token, "key": p.meta.key, "source": p.meta.source, "codec": p.meta.codec, "bitrate": p.meta.bitrate, "duration": p.duration }));
                active = Some(Active { cancel: p.cancel, dec_tx: p.dec_tx, meta: p.meta, duration: p.duration });
                buffering = false;
                last_emit = Instant::now() - POSITION_EVERY;
            }
        }

        let Some(a) = &active else { continue };
        let playing = sh.playing.load(Ordering::Relaxed);

        // hora de começar o crossfade: falta `xf` segundos (de saída) para o fim e a próxima já tem som suficiente
        if let Some(p) = &pending {
            let xf_cfg = f32_load(&sh.xf_secs) as f64;
            if xf_cfg > 0.05 && !p.gapless_pair && !sh.xf_active.load(Ordering::Relaxed) && playing {
                if let Some(dur) = a.duration {
                    let speed = f32_load(&sh.speed).max(0.1) as f64;
                    let pos = position_of(&sh, sh.played_frames.load(Ordering::Relaxed));
                    let xf = xf_cfg.min(dur / 3.0);
                    let remaining = ((dur - pos) / speed).max(0.0);
                    let have = sh.slots[p.slot].buf.lock().data.len() as f64 / 2.0 / rate as f64;
                    if remaining <= xf + 0.02 && have >= xf.min(1.0) {
                        sh.xf_total.store((xf * rate as f64) as u64, Ordering::Relaxed);
                        sh.xf_done.store(0, Ordering::Relaxed);
                        sh.xf_active.store(true, Ordering::Relaxed);
                    }
                }
            }
        }

        if sh.underrun.swap(false, Ordering::Relaxed) && !buffering && playing {
            buffering = true;
            emit("audio:state", json!({ "token": a.meta.token, "state": "buffering" }));
        }
        let cur = sh.cur.load(Ordering::Relaxed);
        if buffering && playing && sh.slots[cur].buf.lock().data.len() > (rate as usize / 4) * 2 {
            buffering = false;
            emit("audio:state", json!({ "token": a.meta.token, "state": "playing" }));
        }
        if sh.finished.swap(false, Ordering::Relaxed) {
            sh.playing.store(false, Ordering::Relaxed);
            emit("audio:ended", json!({ "token": a.meta.token, "key": a.meta.key }));
            // a próxima não ficou pronta a tempo: a interface vai tocá-la do jeito normal
            if let Some(p) = pending.take() { p.cancel.store(true, Ordering::Relaxed); sh.next_armed.store(false, Ordering::Relaxed); sh.xf_active.store(false, Ordering::Relaxed); sh.slots[p.slot].reset(None); }
            continue;
        }
        if playing && last_emit.elapsed() >= POSITION_EVERY {
            last_emit = Instant::now();
            let pos = position_of(&sh, sh.played_frames.load(Ordering::Relaxed));
            emit("audio:position", json!({ "token": a.meta.token, "position": pos, "duration": a.duration, "liveBitrate": sh.slots[sh.cur.load(Ordering::Relaxed)].live_bitrate.load(Ordering::Relaxed) }));
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

#[allow(clippy::too_many_arguments)]
fn decode_loop(
    open: Opener, ext: String, start: f64, sh: Arc<Shared>, rate: u32, slot: usize, is_next: bool, measure: bool,
    cancel: Arc<AtomicBool>, cmds: Receiver<DecCmd>, loaded: Sender<(u64, Option<f64>)>, token: u64, hint_duration: Option<f64>,
) -> Result<(), String> {
    let me = &sh.slots[slot];
    let mut src = open_source(&open, &ext)?;
    let _ = loaded.send((token, src.duration.or(hint_duration)));
    // Quadros de entrada consumidos por quadro de saída; com velocidade > 1 consome mais entrada.
    let mut resampler = Resampler::new((src.src_rate as f64 * f32_load(&sh.speed) as f64) / rate as f64);
    let cap = (rate as f64 * BUFFER_SECONDS) as usize * 2;
    let mut sbuf: Option<SampleBuffer<f32>> = None;
    let (mut out, mut stereo): (Vec<f32>, Vec<f32>) = (Vec::new(), Vec::new());
    let (mut eof, mut skip_until): (bool, Option<f64>) = (false, None);
    let mut queued: std::collections::VecDeque<symphonia::core::formats::Packet> = Default::default();
    let mut meter = measure.then(|| Meter::new(rate as f64));
    let mut live = LiveRate::new();

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
                let mut b = me.buf.lock();
                b.data.clear();
                b.eof = false;
            }
            if !is_next {
                sh.played_frames.store(0, Ordering::Relaxed);
                sh.base_pos.store(t.to_bits(), Ordering::Relaxed);
                sh.finished.store(false, Ordering::Relaxed);
            }
            eof = false;
        }};
    }

    if start > 0.05 { reposition!(start); }

    loop {
        if cancel.load(Ordering::Relaxed) { return Ok(()); }
        let mut seek_to = None;
        while let Ok(DecCmd::Seek(t)) = cmds.try_recv() { seek_to = Some(t); }
        if let Some(t) = seek_to { reposition!(t); }
        if is_next { resampler.ratio = (src.src_rate as f64 * f32_load(&sh.speed) as f64) / rate as f64; }
        if eof { std::thread::sleep(Duration::from_millis(40)); continue; }
        {
            let mut b = me.buf.lock();
            if b.data.len() >= cap { me.space.wait_for(&mut b, Duration::from_millis(40)); continue; }
        }
        let packet = match queued.pop_front() {
            Some(p) => p,
            None => match src.format.next_packet() {
                Ok(p) => p,
                Err(SymErr::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => { if !cancel.load(Ordering::Relaxed) { me.buf.lock().eof = true; } eof = true; continue; }
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
        if let Some(bps) = live.push(packet.buf().len(), decoded.frames(), src.src_rate) { me.live_bitrate.store(bps, Ordering::Relaxed); }
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
        // mede o loudness do começo da faixa (só quando o serviço não informou)
        if let Some(m) = meter.as_mut() {
            if m.push(&out) {
                if let Some(l) = m.lufs() { me.lufs.store(l.to_bits(), Ordering::Relaxed); }
                if m.blocks.len() >= 150 { meter = None; } // 60 s bastam
            }
        }
        let mut b = me.buf.lock();
        if cancel.load(Ordering::Relaxed) { return Ok(()); } // nunca escreve depois de cancelado (o slot pode já ser de outra faixa)
        b.data.extend(out.iter().copied());
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn bitrate_ao_vivo_por_janela_de_um_segundo() {
        let mut r = super::LiveRate::new();
        // 44,1 kHz: 4096 quadros por pacote; 10 pacotes passam de 0,9 s, 11 passam de 1 s
        for _ in 0..10 { assert_eq!(r.push(10_000, 4096, 44_100), None); }
        let bps = r.push(10_000, 4096, 44_100).expect("fechou a janela");
        let esperado = (110_000.0 * 8.0 / (11.0 * 4096.0 / 44_100.0)) as u32;
        assert!((bps as i64 - esperado as i64).abs() < 5, "{bps} vs {esperado}");
        // a janela recomeça do zero e uma faixa mais densa dá uma taxa maior
        let mut r2 = super::LiveRate::new();
        let maior = (0..11).filter_map(|_| r2.push(30_000, 4096, 44_100)).next().unwrap();
        assert!(maior > bps * 2);
        assert_eq!(super::LiveRate::new().push(1, 1, 0), None);
    }


    use super::*;

    fn sine(freq: f32, amp: f32, fs: f32, secs: f32) -> Vec<f32> {
        (0..(fs * secs) as usize).flat_map(|i| { let v = amp * (2.0 * std::f32::consts::PI * freq * i as f32 / fs).sin(); [v, v] }).collect()
    }
    fn rms(x: &[f32]) -> f32 { (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt() }

    #[test]
    fn equalizador_aplica_o_ganho_na_frequencia_da_banda() {
        let fs = 48_000.0;
        for (band, gain) in [(5usize, 6.0f32), (2, -9.0), (8, 4.0)] {
            let mut eq = Eq::new();
            eq.on = true; eq.pre = 1.0; eq.ver = 0;
            for i in 0..EQ_BANDS { eq.active[i] = i == band; eq.coef[i] = if i == band { Biquad::peaking(EQ_FREQS[i], gain, EQ_Q, fs) } else { Biquad::IDENTITY }; }
            let input = sine(EQ_FREQS[band], 0.1, fs, 1.0);
            let out: Vec<f32> = input.chunks_exact(2).map(|f| eq.process(0, f[0])).collect();
            let measured = 20.0 * (rms(&out[24_000..]) / rms(&input.iter().step_by(2).copied().collect::<Vec<_>>()[24_000..])).log10();
            assert!((measured - gain).abs() < 0.3, "banda {band}: esperado {gain} dB, medido {measured:.2} dB");
        }
    }

    #[test]
    fn equalizador_nao_mexe_em_frequencias_distantes() {
        let fs = 48_000.0;
        let mut eq = Eq::new();
        eq.on = true; eq.pre = 1.0;
        eq.active[1] = true; eq.coef[1] = Biquad::peaking(EQ_FREQS[1], 12.0, EQ_Q, fs); // +12 dB em 62 Hz
        let input = sine(8000.0, 0.1, fs, 1.0);
        let out: Vec<f32> = input.chunks_exact(2).map(|f| eq.process(0, f[0])).collect();
        let mono: Vec<f32> = input.iter().step_by(2).copied().collect();
        let diff = 20.0 * (rms(&out[24_000..]) / rms(&mono[24_000..])).log10();
        assert!(diff.abs() < 0.2, "8 kHz mudou {diff:.2} dB com a banda de 62 Hz");
    }

    #[test]
    fn medidor_de_loudness_confere_com_a_referencia_bs1770() {
        // BS.1770: seno de 997 Hz em escala cheia em UM canal = −3,01 LUFS; nos dois canais, a energia dobra = 0 LUFS
        let fs = 48_000.0;
        let both = sine(997.0, 1.0, fs, 6.0);
        let mut m = Meter::new(fs as f64);
        m.push(&both);
        let stereo = m.lufs().expect("medição");
        assert!(stereo.abs() < 0.2, "dois canais: {stereo:.2} LUFS");
        let one: Vec<f32> = both.chunks_exact(2).flat_map(|f| [f[0], 0.0]).collect();
        let mut o = Meter::new(fs as f64);
        o.push(&one);
        let mono = o.lufs().unwrap();
        assert!((mono + 3.01).abs() < 0.2, "um canal: {mono:.2} LUFS");
        // −20 dB na amplitude = −20 LU
        let mut q = Meter::new(fs as f64);
        q.push(&sine(997.0, 0.1, fs, 6.0));
        let quiet = q.lufs().unwrap();
        assert!((quiet - (stereo - 20.0)).abs() < 0.2, "−20 dB: {quiet:.2} LUFS (cheia {stereo:.2})");
    }

    #[test]
    fn silencio_nao_tem_loudness() {
        let mut m = Meter::new(48_000.0);
        m.push(&vec![0.0f32; 48_000 * 2 * 4]);
        assert!(m.lufs().is_none());
    }

    #[test]
    fn limitador_suave_nunca_passa_de_um() {
        assert_eq!(soft_clip(0.5), 0.5);
        for x in [0.95f32, 1.0, 1.5, 4.0, -3.0] { assert!(soft_clip(x).abs() <= 1.0, "{x} -> {}", soft_clip(x)); }
        assert!(soft_clip(2.0) > soft_clip(1.0)); // continua crescendo (sem platô duro)
    }
}
