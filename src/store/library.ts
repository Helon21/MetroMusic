import { create } from "zustand";
import { persist } from "zustand/middleware";
import { albums, artists, getPlaylist, playlists as catalogPlaylists, podcasts, rng, sample, songs, type Playlist } from "../lib/catalog";
import { getSetting } from "./settings";
import { toast } from "./ui";

export interface Pin { type: "track" | "album" | "artist" | "playlist"; id: string }
export interface HistoryEntry { id: string; at: number }
export interface Recognition { id: string; at: number }

interface Lib {
  liked: string[]; savedAlbums: string[]; followed: string[]; savedPlaylists: string[]; subscribedPodcasts: string[]; later: string[];
  playlists: Playlist[]; downloads: Record<string, number>; cached: string[]; localFiles: string[];
  pins: Pin[]; history: HistoryEntry[]; searchHistory: string[]; recognitions: Recognition[]; counts: Record<string, number>;
  folders: string[]; accounts: Record<string, string>;
  toggleLike: (id: string) => void; setLiked: (ids: string[], on: boolean) => void;
  toggleAlbum: (id: string) => void; toggleFollow: (id: string) => void; toggleSavedPlaylist: (id: string) => void;
  togglePodcast: (id: string) => void; toggleLater: (id: string) => void;
  createPlaylist: (title: string, trackIds?: string[], extra?: Partial<Playlist>) => string;
  updatePlaylist: (id: string, patch: Partial<Playlist>) => void; deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, trackIds: string[], allowDup?: boolean) => number; removeFromPlaylist: (id: string, trackIds: string[]) => void;
  download: (ids: string[]) => void; removeDownload: (ids: string[]) => void; tickDownloads: () => void;
  togglePin: (p: Pin) => void; pushHistory: (id: string) => void; removeHistory: (at: number) => void;
  pushSearch: (q: string) => void; removeSearch: (q: string) => void;
  addRecognition: (id: string) => void; removeRecognition: (at: number) => void;
  setAccount: (service: string, name: string | null) => void; setFolders: (f: string[]) => void;
  clear: (what: "history" | "searchHistory" | "downloads" | "cached" | "recognitions") => void;
}

/** Estado inicial: vazio. Tudo o que aparece vem do uso real (reproduções, curtidas, conta). */
function seed() {
  return {
    liked: [] as string[], savedAlbums: [] as string[], followed: [] as string[], savedPlaylists: [] as string[], subscribedPodcasts: [] as string[], later: [] as string[],
    playlists: [] as Playlist[], downloads: {} as Record<string, number>, cached: [] as string[], localFiles: [] as string[],
    pins: [] as Pin[], history: [] as HistoryEntry[], counts: {} as Record<string, number>, searchHistory: [] as string[], recognitions: [] as Recognition[],
    folders: [] as string[], accounts: {} as Record<string, string>,
  };
}

/** Ids de faixas/coleções reais têm "provedor:id" (ou prefixo ext…); os de demonstração, não. */
const isReal = (id: string) => id.includes(":") || id.startsWith("ext");

/** Remove do estado guardado tudo o que veio dos dados de demonstração (versões antigas do app). */
function purgeMock(p: any) {
  if (!p || typeof p !== "object") return p;
  const keep = (a: unknown) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && isReal(x)) : []);
  const pick = (o: unknown) => Object.fromEntries(Object.entries((o as Record<string, number>) ?? {}).filter(([k]) => isReal(k)));
  return {
    ...p,
    liked: keep(p.liked), cached: keep(p.cached), localFiles: keep(p.localFiles), savedAlbums: keep(p.savedAlbums), followed: keep(p.followed), savedPlaylists: keep(p.savedPlaylists),
    downloads: pick(p.downloads), counts: pick(p.counts),
    history: (p.history ?? []).filter((h: HistoryEntry) => isReal(h.id)),
    recognitions: (p.recognitions ?? []).filter((r: Recognition) => isReal(r.id)),
    pins: (p.pins ?? []).filter((x: Pin) => isReal(x.id)),
    // playlists criadas pelo usuário ficam (só sem as faixas de demonstração); as de exemplo saem
    playlists: (p.playlists ?? []).filter((pl: Playlist) => !catalogPlaylists.some((c) => c.id === pl.id)).map((pl: Playlist) => ({ ...pl, trackIds: pl.trackIds.filter(isReal) })),
    searchHistory: [], folders: [], accounts: {},
  };
}

export const useLib = create<Lib>()(
  persist(
    (set, get) => {
      const toggle = (key: "liked" | "savedAlbums" | "followed" | "savedPlaylists" | "subscribedPodcasts" | "later", id: string) =>
        set((s) => ({ [key]: s[key].includes(id) ? s[key].filter((x) => x !== id) : [id, ...s[key]] }) as Partial<Lib>);
      return {
        ...seed(),
        toggleLike: (id) => { const was = get().liked.includes(id); toggle("liked", id); if (!was && getSetting("autoDownloadOnLike")) get().download([id]); },
        setLiked: (ids, on) => set((s) => ({ liked: on ? [...ids.filter((i) => !s.liked.includes(i)), ...s.liked] : s.liked.filter((i) => !ids.includes(i)) })),
        toggleAlbum: (id) => toggle("savedAlbums", id), toggleFollow: (id) => toggle("followed", id), toggleSavedPlaylist: (id) => toggle("savedPlaylists", id),
        togglePodcast: (id) => toggle("subscribedPodcasts", id), toggleLater: (id) => toggle("later", id),
        createPlaylist: (title, trackIds = [], extra = {}) => {
          const id = `u${Date.now().toString(36)}`;
          set((s) => ({ playlists: [{ id, title, description: "", owner: "Você", kind: "local", hue: Math.floor(Math.random() * 360), seed: Math.floor(Math.random() * 1e6), trackIds, created: Date.now(), updated: Date.now(), ...extra }, ...s.playlists] }));
          return id;
        },
        updatePlaylist: (id, patch) => set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, ...patch, updated: Date.now() } : p)) })),
        deletePlaylist: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id), pins: s.pins.filter((p) => p.id !== id) })),
        addToPlaylist: (id, trackIds, allowDup = false) => {
          const p = get().playlists.find((x) => x.id === id); if (!p) return 0;
          const add = allowDup ? trackIds : trackIds.filter((t) => !p.trackIds.includes(t));
          if (add.length) get().updatePlaylist(id, { trackIds: [...p.trackIds, ...add] });
          return add.length;
        },
        removeFromPlaylist: (id, trackIds) => { const p = get().playlists.find((x) => x.id === id); if (p) get().updatePlaylist(id, { trackIds: p.trackIds.filter((t) => !trackIds.includes(t)) }); },
        download: (ids) => set((s) => { const d = { ...s.downloads }; ids.forEach((i) => { if (!(i in d)) d[i] = 0.001; }); return { downloads: d }; }),
        removeDownload: (ids) => set((s) => { const d = { ...s.downloads }; ids.forEach((i) => delete d[i]); return { downloads: d }; }),
        tickDownloads: () => {
          const d = get().downloads; let changed = false; const next = { ...d }; let active = 0;
          for (const k in next) if (next[k] < 1 && active < 3) { active++; next[k] = Math.min(1, next[k] + 0.08 + Math.random() * 0.1); changed = true; if (next[k] === 1 && !Object.values(next).some((v) => v < 1)) toast("Downloads concluídos"); }
          if (changed) set({ downloads: next });
        },
        togglePin: (p) => set((s) => (s.pins.some((x) => x.id === p.id) ? { pins: s.pins.filter((x) => x.id !== p.id) } : { pins: [...s.pins, p] })),
        pushHistory: (id) => set((s) => ({ history: [{ id, at: Date.now() }, ...s.history].slice(0, 2000), counts: { ...s.counts, [id]: (s.counts[id] ?? 0) + 1 }, cached: s.cached.includes(id) || !getSetting("songCache") ? s.cached : [id, ...s.cached] })),
        removeHistory: (at) => set((s) => ({ history: s.history.filter((h) => h.at !== at) })),
        pushSearch: (q) => set((s) => ({ searchHistory: [q, ...s.searchHistory.filter((x) => x !== q)].slice(0, 12) })),
        removeSearch: (q) => set((s) => ({ searchHistory: s.searchHistory.filter((x) => x !== q) })),
        addRecognition: (id) => set((s) => ({ recognitions: [{ id, at: Date.now() }, ...s.recognitions] })),
        removeRecognition: (at) => set((s) => ({ recognitions: s.recognitions.filter((r) => r.at !== at) })),
        setAccount: (service, name) => set((s) => { const a = { ...s.accounts }; if (name) a[service] = name; else delete a[service]; return { accounts: a }; }),
        setFolders: (folders) => set({ folders }),
        clear: (what) => set(what === "downloads" ? { downloads: {} } : ({ [what]: [] } as Partial<Lib>)),
      };
    },
    { name: "metromusic-library-v1", version: 2, migrate: (p: any, v: number) => (v < 2 ? purgeMock(p) : p) },
  ),
);

const top = (counts: Record<string, number>, n: number) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
const since = (h: HistoryEntry[], days: number) => { const c: Record<string, number> = {}; const lim = Date.now() - days * 864e5; h.forEach((e) => { if (e.at >= lim) c[e.id] = (c[e.id] ?? 0) + 1; }); return c; };

export const AUTO: Record<string, { title: string; description: string; hue: number; icon: string }> = {
  liked: { title: "Curtidas", description: "Tudo o que você marcou com um coração.", hue: 350, icon: "heart" },
  downloaded: { title: "Baixadas", description: "Disponíveis sem internet.", hue: 150, icon: "download" },
  top: { title: "Meu Top", description: "As que você mais ouviu.", hue: 45, icon: "trending" },
  cached: { title: "Em cache", description: "Ouvidas recentemente e guardadas no disco.", hue: 215, icon: "cache" },
  local: { title: "Arquivos locais", description: "Músicas das suas pastas.", hue: 180, icon: "folder" },
  uploaded: { title: "Enviadas", description: "Arquivos enviados para a sua conta.", hue: 265, icon: "upload" },
  weekly: { title: "Mais ouvidas da semana", description: "Gerada a partir das suas estatísticas.", hue: 20, icon: "trending" },
  monthly: { title: "Mais ouvidas do mês", description: "Gerada a partir das suas estatísticas.", hue: 300, icon: "trending" },
  later: { title: "Episódios para depois", description: "Episódios que você salvou.", hue: 95, icon: "clock" },
};

/** Resolve qualquer playlist: do usuário, automática ou do catálogo. */
export function resolvePlaylist(id: string, s: Lib = useLib.getState()): Playlist | undefined {
  const own = s.playlists.find((p) => p.id === id);
  if (own) return own;
  const auto = AUTO[id];
  if (auto) {
    const trackIds =
      id === "liked" ? s.liked : id === "downloaded" ? Object.keys(s.downloads).filter((k) => s.downloads[k] >= 1) : id === "top" ? top(s.counts, getSetting<number>("topLength"))
      : id === "cached" ? s.cached : id === "local" ? s.localFiles : id === "weekly" ? top(since(s.history, 7), 30) : id === "monthly" ? top(since(s.history, 30), 50)
      : id === "later" ? s.later : [];
    return { id, title: auto.title, description: auto.description, owner: "Automática", kind: "auto", hue: auto.hue, seed: auto.hue * 31, trackIds, icon: auto.icon };
  }
  return getPlaylist(id);
}

/** "Meu Top" restrito aos últimos `days` dias, respeitando o tamanho configurado. */
export const topFor = (days: number) => top(since(useLib.getState().history, days), getSetting<number>("topLength"));
