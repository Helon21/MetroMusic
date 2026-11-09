import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getTrack, sample, songs, type SourceId, type Track } from "../lib/catalog";
import { useLib } from "./library";
import { backend, engine } from "../lib/engine";
import { onEvent } from "../lib/native";
import { getSetting, useSettings } from "./settings";
import { toast } from "./ui";

// Reprodução. Faixas reais (com `ext`) tocam pelo backend: posição, estado, fim e erro chegam como
// eventos `audio:*`. As faixas de demonstração continuam no simulador (`tick`), que também é o
// que roda fora do Tauri.

export type Repeat = "off" | "all" | "one";
interface Sleep { endsAt?: number; endOfSong?: boolean }

export interface EngineInfo { key: string; source: string; codec: string; bitrate: number }

interface Player {
  engineToken: number; info: EngineInfo | null;
  trackEnded: () => void;
  queue: string[]; index: number; position: number; playing: boolean; buffering: boolean; error: string | null;
  shuffle: boolean; repeat: Repeat; volume: number; muted: boolean; speed: number; pitch: number;
  queueTitle: string; unshuffled: string[] | null; sleep: Sleep | null; sourceOverride: Record<string, SourceId>;
  radioOf: string | null;
  play: (ids: string[], start?: number, title?: string, opts?: { shuffle?: boolean }) => void;
  playNext: (ids: string[]) => void; addToQueue: (ids: string[]) => void;
  toggle: () => void; next: (auto?: boolean) => void; prev: () => void; seek: (s: number) => void; jump: (i: number) => void;
  remove: (i: number) => void; reorder: (ids: string[]) => void; clearUpcoming: () => void;
  toggleShuffle: () => void; cycleRepeat: () => void; setVolume: (v: number) => void; toggleMute: () => void;
  setSpeed: (v: number) => void; setPitch: (v: number) => void; setSleep: (s: Sleep | null) => void;
  setSource: (trackId: string, src: SourceId | null) => void; startRadio: (trackId: string) => void;
  setError: (e: string | null) => void; tick: (dt: number) => void;
}

let bufferTimer: ReturnType<typeof setTimeout> | undefined;

/** A posição muda várias vezes por segundo; gravar no disco a cada vez trava a interface. Agrupa em 1 s. */
const slowStorage = (() => {
  let timer: ReturnType<typeof setTimeout> | undefined; let pending: [string, string] | null = null;
  const flush = () => { if (pending) { try { localStorage.setItem(pending[0], pending[1]); } catch { /* sem espaço */ } pending = null; } };
  if (typeof window !== "undefined") { window.addEventListener("beforeunload", flush); window.addEventListener("pagehide", flush); }
  return {
    getItem: (n: string) => localStorage.getItem(n),
    setItem: (n: string, v: string) => { pending = [n, v]; clearTimeout(timer); timer = setTimeout(flush, 1000); },
    removeItem: (n: string) => localStorage.removeItem(n),
  };
})();
const shuffled = (ids: string[]) => { const a = [...ids]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const usePlayer = create<Player>()(
  persist(
    (set, get) => {
      /** Faixa real (do backend) ou `undefined` para as de demonstração. */
      const real = (id?: string) => { const t = id ? getTrack(id) : undefined; return backend && t?.ext ? t : undefined; };
      const syncVolume = () => { const s = get(); engine.setVolume(s.muted ? 0 : s.volume); };
      /** Troca de faixa: registra no histórico e começa a tocar (no backend ou no simulador). */
      const started = (extra: Partial<Player> = {}) => {
        set({ position: 0, playing: true, buffering: true, error: null, info: null, ...extra });
        clearTimeout(bufferTimer);
        const id = get().queue[get().index];
        const t = real(id);
        if (t) {
          engine.play(t.ext!, 0)
            .then((token) => { if (token && token > get().engineToken) set({ engineToken: token }); })
            .catch((e) => get().setError(String(e)));
        } else {
          if (backend) engine.stop();
          bufferTimer = setTimeout(() => set({ buffering: false }), 450);
        }
        if (id && !getSetting("pauseHistory")) useLib.getState().pushHistory(id);
      };
      const similar = (seedId: string, n = 15) => {
        const t = getTrack(seedId); const inQueue = new Set(get().queue);
        const pool = songs.filter((s) => !inQueue.has(s.id));
        const same = pool.filter((s) => s.artistId === t?.artistId);
        return [...sample(same, 3, Date.now()), ...sample(pool, n, Date.now() + 1)].slice(0, n).map((s) => s.id);
      };
      return {
        engineToken: 0, info: null,
        trackEnded: () => {
          const s = get();
          if (s.sleep?.endOfSong) { toast("Timer de sono: reprodução pausada"); if (real(s.queue[s.index])) engine.pause(); return set({ playing: false, sleep: null, position: 0 }); }
          if (s.repeat === "one") return started();
          if (!getSetting("autoplay")) return set({ playing: false, position: 0 });
          s.next(true);
        },
        queue: [], index: 0, position: 0, playing: false, buffering: false, error: null,
        shuffle: false, repeat: "off", volume: 0.8, muted: false, speed: 1, pitch: 0,
        queueTitle: "", unshuffled: null, sleep: null, sourceOverride: {}, radioOf: null,

        play: (ids, start = 0, title = "", opts) => {
          if (!ids.length) return;
          const wantShuffle = opts?.shuffle ?? (getSetting("persistentShuffle") ? get().shuffle : false);
          if (wantShuffle) {
            const first = opts?.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[start];
            set({ queue: [first, ...shuffled(ids.filter((i) => i !== first))], unshuffled: ids, index: 0, shuffle: true, queueTitle: title, radioOf: null });
          } else set({ queue: ids, index: start, unshuffled: null, shuffle: false, queueTitle: title, radioOf: null });
          started();
        },
        playNext: (ids) => {
          const s = get();
          if (!s.queue.length) return s.play(ids);
          const cur = s.queue[s.index];
          const rest = getSetting("preventDuplicates") ? s.queue.filter((q) => q === cur || !ids.includes(q)) : s.queue;
          const at = rest.indexOf(cur) + 1;
          set({ queue: [...rest.slice(0, at), ...ids.filter((i) => i !== cur), ...rest.slice(at)], index: at - 1 });
          toast(ids.length > 1 ? `${ids.length} músicas tocam a seguir` : "Toca a seguir");
        },
        addToQueue: (ids) => {
          const s = get();
          if (!s.queue.length) return s.play(ids);
          const cur = s.queue[s.index];
          const rest = getSetting("preventDuplicates") ? s.queue.filter((q) => q === cur || !ids.includes(q)) : s.queue;
          set({ queue: [...rest, ...ids.filter((i) => i !== cur)], index: rest.indexOf(cur) });
          toast(ids.length > 1 ? `${ids.length} músicas adicionadas à fila` : "Adicionada à fila");
        },
        toggle: () => {
          const s = get(); if (!s.queue.length) return;
          const t = real(s.queue[s.index]);
          if (s.error) return t ? s.jump(s.index) : set({ error: null, playing: true });
          if (t) { if (s.playing) engine.pause(); else engine.resume(); }
          set({ playing: !s.playing });
        },
        next: (auto = false) => {
          const s = get(); if (!s.queue.length) return;
          if (s.index < s.queue.length - 1) return started({ index: s.index + 1 });
          if (s.repeat === "all") return started({ index: 0 });
          if (getSetting("autoLoadMore") && getSetting("similarContent")) {
            const more = similar(s.queue[s.index]);
            if (more.length) { set({ queue: [...s.queue, ...more] }); return started({ index: s.index + 1 }); }
          }
          if (auto) set({ playing: false, position: 0 });
        },
        prev: () => { const s = get(); if (s.position > 3 || s.index === 0) return set({ position: 0 }); started({ index: s.index - 1 }); },
        seek: (position) => {
          const id = get().queue[get().index]; const t = getTrack(id);
          const to = Math.max(0, Math.min(position, (t?.duration || position + 1) - 0.5));
          set({ position: to });
          if (real(id)) engine.seek(to);
        },
        jump: (i) => started({ index: i }),
        remove: (i) => { const s = get(); if (i === s.index) return; set({ queue: s.queue.filter((_, k) => k !== i), index: i < s.index ? s.index - 1 : s.index }); },
        reorder: (ids) => { const cur = get().queue[get().index]; set({ queue: ids, index: Math.max(0, ids.indexOf(cur)) }); },
        clearUpcoming: () => set((s) => ({ queue: s.queue.slice(0, s.index + 1) })),
        toggleShuffle: () => {
          const s = get(); const cur = s.queue[s.index];
          if (!s.shuffle) set({ shuffle: true, unshuffled: s.queue, queue: [...s.queue.slice(0, s.index + 1), ...shuffled(s.queue.slice(s.index + 1))] });
          else { const q = s.unshuffled?.filter((i) => s.queue.includes(i)) ?? s.queue; set({ shuffle: false, unshuffled: null, queue: q, index: Math.max(0, q.indexOf(cur)) }); }
        },
        cycleRepeat: () => set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" })),
        setVolume: (volume) => { set({ volume: Math.max(0, Math.min(1, volume)), muted: false }); syncVolume(); },
        toggleMute: () => { set((s) => ({ muted: !s.muted })); syncVolume(); },
        setSpeed: (speed) => { set({ speed }); engine.setSpeed(speed); }, setPitch: (pitch) => set({ pitch }),
        setSleep: (sleep) => set({ sleep }),
        setSource: (trackId, src) => {
          set((s) => { const o = { ...s.sourceOverride }; if (src) o[trackId] = src; else delete o[trackId]; return { sourceOverride: o, buffering: s.queue[s.index] === trackId }; });
          clearTimeout(bufferTimer);
          bufferTimer = setTimeout(() => set({ buffering: false }), 600);
        },
        startRadio: (trackId) => {
          const t = getTrack(trackId); if (!t) return;
          toast("Iniciando rádio…");
          set({ queue: [trackId], index: 0, unshuffled: null, shuffle: false, queueTitle: `Rádio de ${t.title}`, radioOf: trackId });
          set({ queue: [trackId, ...similar(trackId, 24)] });
          started();
        },
        setError: (error) => set({ error, playing: false, buffering: false }),
        tick: (dt) => {
          const s = get();
          if (!s.playing || s.buffering || s.error) return;
          if (s.sleep?.endsAt && Date.now() >= s.sleep.endsAt) { toast("Timer de sono: reprodução pausada"); if (real(s.queue[s.index])) engine.pause(); return set({ playing: false, sleep: null }); }
          const t = getTrack(s.queue[s.index]); if (!t) return;
          if (real(t.id)) return; // a posição de faixas reais vem do motor, por evento
          const position = s.position + dt * s.speed;
          if (position < t.duration) return set({ position });
          s.trackEnded();
        },
      };
    },
    {
      name: "metromusic-player-v1",
      storage: createJSONStorage(() => slowStorage),
      partialize: (s) => ({ queue: s.queue, index: s.index, position: s.position, shuffle: s.shuffle, repeat: s.repeat, volume: s.volume, muted: s.muted, queueTitle: s.queueTitle, speed: s.speed, pitch: s.pitch }) as any,
    },
  ),
);

export const useCurrent = (): Track | undefined => usePlayer((s) => getTrack(s.queue[s.index]));
export const currentTrack = () => { const s = usePlayer.getState(); return getTrack(s.queue[s.index]); };
/** Provedor efetivo da faixa, considerando a escolha manual de fonte. */
export const useProvider = (t?: Track) => usePlayer((s) => (t ? (s.sourceOverride[t.id] ?? t.provider) : undefined));

// ───────── Backend: pré-cache, cache e eventos de áudio

let precacheTimer: ReturnType<typeof setTimeout> | undefined;
/** Diz ao backend quais são as próximas faixas reais da fila (ele baixa só o começo de cada uma). */
export function syncPrecache() {
  if (!backend) return;
  clearTimeout(precacheTimer);
  precacheTimer = setTimeout(() => {
    const s = usePlayer.getState();
    const count = Number(getSetting("preload")) || 0;
    const upcoming = s.repeat === "one" ? [] : s.queue.slice(s.index + 1).map((id) => getTrack(id)).filter((t) => t?.ext).map((t) => t!.ext!);
    engine.precache(upcoming, count);
  }, 250);
}

/** Liga os eventos `audio:*` ao player e leva ao backend as configurações de volume, cache e pré-cache. */
export async function initBackend() {
  if (!backend) return;
  const P = usePlayer;
  const current = () => { const s = P.getState(); return getTrack(s.queue[s.index]); };
  // Eventos de uma reprodução anterior (token menor) ou de uma faixa de demonstração são ignorados.
  const fresh = (p: { token: number }) => {
    if (!current()?.ext) return false;
    const have = P.getState().engineToken;
    if (p.token < have) return false;
    if (p.token > have) P.setState({ engineToken: p.token });
    return true;
  };
  const fixDuration = (sec: number) => { const t = current(); if (t && Math.abs(t.duration - sec) > 1) t.duration = Math.round(sec); };

  await onEvent<any>("audio:position", (p) => { if (!fresh(p)) return; P.setState({ position: p.position }); if (p.duration) fixDuration(p.duration); });
  await onEvent<any>("audio:state", (p) => {
    if (!fresh(p)) return;
    if (p.state === "loading" || p.state === "buffering") P.setState({ buffering: true });
    else if (p.state === "playing") P.setState({ buffering: false, playing: true });
    else if (p.state === "paused") P.setState({ playing: false });
    else if (p.state === "error") P.getState().setError(p.message ?? "Erro de reprodução");
  });
  await onEvent<any>("audio:loaded", (p) => {
    if (!fresh(p)) return;
    P.setState({ info: { key: p.key, source: p.source, codec: p.codec, bitrate: p.bitrate } });
    if (p.duration) fixDuration(p.duration);
  });
  await onEvent<any>("audio:ended", (p) => { if (fresh(p)) P.getState().trackEnded(); });

  const syncCache = () => { const mb = Number(getSetting("maxSongCache")); engine.cacheConfigure(mb < 0 ? 1_000_000 : mb, !!getSetting("songCache")); };
  syncCache();
  const s0 = P.getState(); engine.setVolume(s0.muted ? 0 : s0.volume); engine.setSpeed(s0.speed);
  P.subscribe((s, prev) => { if (s.queue !== prev.queue || s.index !== prev.index || s.repeat !== prev.repeat) syncPrecache(); });
  const watched = ["songCache", "maxSongCache", "preload", "providerOrder", "providerOff"];
  const read = () => JSON.stringify(watched.map((k) => getSetting(k)));
  let last = read();
  useSettings.subscribe(() => {
    const now = read(); if (now === last) return; last = now;
    syncCache(); syncPrecache();
  });
  syncPrecache();
}
