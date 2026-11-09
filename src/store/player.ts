import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getTrack, sample, songs, type SourceId, type Track } from "../lib/catalog";
import { useLib } from "./library";
import { getSetting } from "./settings";
import { toast } from "./ui";

// Simulador de reprodução. O backend troca o relógio (`tick`) por eventos reais
// de posição e mantém a mesma superfície de ações.

export type Repeat = "off" | "all" | "one";
interface Sleep { endsAt?: number; endOfSong?: boolean }

interface Player {
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
const shuffled = (ids: string[]) => { const a = [...ids]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const usePlayer = create<Player>()(
  persist(
    (set, get) => {
      /** Troca de faixa: registra no histórico e simula o carregamento do stream. */
      const started = (extra: Partial<Player> = {}) => {
        set({ position: 0, playing: true, buffering: true, error: null, ...extra });
        clearTimeout(bufferTimer);
        bufferTimer = setTimeout(() => set({ buffering: false }), 450);
        const id = get().queue[get().index];
        if (id && !getSetting("pauseHistory")) useLib.getState().pushHistory(id);
      };
      const similar = (seedId: string, n = 15) => {
        const t = getTrack(seedId); const inQueue = new Set(get().queue);
        const pool = songs.filter((s) => !inQueue.has(s.id));
        const same = pool.filter((s) => s.artistId === t?.artistId);
        return [...sample(same, 3, Date.now()), ...sample(pool, n, Date.now() + 1)].slice(0, n).map((s) => s.id);
      };
      return {
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
        toggle: () => { const s = get(); if (!s.queue.length) return; if (s.error) return set({ error: null, playing: true }); set({ playing: !s.playing }); },
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
        seek: (position) => { const t = getTrack(get().queue[get().index]); set({ position: Math.max(0, Math.min(position, (t?.duration ?? 1) - 0.5)) }); },
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
        setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)), muted: false }),
        toggleMute: () => set((s) => ({ muted: !s.muted })),
        setSpeed: (speed) => set({ speed }), setPitch: (pitch) => set({ pitch }),
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
          if (s.sleep?.endsAt && Date.now() >= s.sleep.endsAt) { toast("Timer de sono: reprodução pausada"); return set({ playing: false, sleep: null }); }
          const t = getTrack(s.queue[s.index]); if (!t) return;
          const position = s.position + dt * s.speed;
          if (position < t.duration) return set({ position });
          if (s.sleep?.endOfSong) { toast("Timer de sono: reprodução pausada"); return set({ playing: false, sleep: null, position: 0 }); }
          if (s.repeat === "one") return started();
          if (!getSetting("autoplay")) return set({ playing: false, position: 0 });
          s.next(true);
        },
      };
    },
    {
      name: "metromusic-player-v1",
      partialize: (s) => ({ queue: s.queue, index: s.index, position: s.position, shuffle: s.shuffle, repeat: s.repeat, volume: s.volume, muted: s.muted, queueTitle: s.queueTitle, speed: s.speed, pitch: s.pitch }) as any,
    },
  ),
);

export const useCurrent = (): Track | undefined => usePlayer((s) => getTrack(s.queue[s.index]));
export const currentTrack = () => { const s = usePlayer.getState(); return getTrack(s.queue[s.index]); };
/** Provedor efetivo da faixa, considerando a escolha manual de fonte. */
export const useProvider = (t?: Track) => usePlayer((s) => (t ? (s.sourceOverride[t.id] ?? t.provider) : undefined));
