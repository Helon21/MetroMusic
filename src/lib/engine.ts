// Ponte da interface com o backend de áudio (src-tauri). Fora do Tauri, `backend` é falso e o app
// usa só o catálogo de demonstração e o simulador de reprodução.

import { invoke, isTauri } from "./native";
import { getSetting } from "../store/settings";
import type { ExtInfo } from "./catalog";

export const backend = isTauri;

// ───────── YouTube Music (Início, páginas, rádio) — formatos de src-tauri/src/providers/ytmusic.rs
export interface RCollection { kind: "album" | "playlist" | "artist" | "mix"; id: string; title: string; subtitle: string; artwork?: string | null }
export interface YtAccountInfo { name: string; email?: string | null; handle?: string | null; avatar?: string | null }
export interface SpStatus { hasClientId: boolean; loggedIn: boolean; redirect: string }
export interface ScAccountInfo { id: number; name: string; handle?: string | null; avatar?: string | null }
export interface RItem { track?: ExtInfo; collection?: RCollection }
export interface RSection { title: string; label?: string | null; layout: "list" | "carousel" | "grid"; items: RItem[]; more?: string | null }
export interface RTile { title: string; browseId: string; params?: string | null; color?: string | null }
export interface RExplore { title: string; sections: RSection[]; groups: { title: string; tiles: RTile[] }[] }
export interface RChip { title: string; browseId: string; params?: string | null }
export interface RHome { chips: RChip[]; sections: RSection[]; continuation?: string | null; personalized: boolean }
export interface RPage { kind: string; id: string; title: string; subtitle: string; description?: string | null; artwork?: string | null; tracks: ExtInfo[]; sections: RSection[]; items: RItem[] }

/** Provedores que tocam músicas inteiras, na ordem em que o app tenta achar a mesma faixa (para o Deezer). */
export function playbackOrder(): string[] {
  const saved: string[] = getSetting("providerOrder") ?? [];
  const off: string[] = getSetting("providerOff") ?? [];
  const order = saved.filter((p) => (p === "youtube" || p === "soundcloud") && !off.includes(p));
  return order.length ? order : ["youtube", "soundcloud"].filter((p) => !off.includes(p));
}

export const SEARCHABLE = ["youtube", "soundcloud", "deezer", "spotify"];

export const engine = {
  search: (provider: string, query: string, limit = 24) => invoke<ExtInfo[]>("search_online", { provider, query, limit }),
  play: (track: ExtInfo, start = 0) => invoke<number>("audio_play", { track, start, autoplay: true, order: playbackOrder() }),
  pause: () => invoke("audio_pause"),
  resume: () => invoke("audio_resume"),
  seek: (seconds: number) => invoke("audio_seek", { seconds }),
  stop: () => invoke("audio_stop"),
  setVolume: (volume: number) => invoke("audio_set_volume", { volume }),
  setSpeed: (speed: number) => invoke("audio_set_speed", { speed }),
  precache: (tracks: ExtInfo[], count: number) => invoke("audio_precache", { tracks, count, order: playbackOrder() }),
  lyrics: (track: ExtInfo, order: string[]) => invoke<unknown>("lyrics_get", { track, order }),
  ytLoginStart: () => invoke("yt_login_start"),
  ytLoginCancel: () => invoke("yt_login_cancel"),
  ytLoginCookie: (cookie: string) => invoke<YtAccountInfo>("yt_login_cookie", { cookie }),
  ytAccount: () => invoke<YtAccountInfo | null>("yt_account"),
  ytLogout: () => invoke("yt_logout"),
  ytLibrary: (kind: "songs" | "playlists" | "albums" | "artists" | "history") => invoke<RPage>("yt_library", { kind }),
  ytRate: (videoId: string, like: boolean) => invoke("yt_rate", { videoId, like }),
  ytMarkPlayed: (videoId: string, playedSecs: number) => invoke("yt_mark_played", { videoId, playedSecs }),
  ytExplore: (browseId: string, params?: string | null) => invoke<RExplore>("yt_explore", { browseId, params }),
  scLoginStart: () => invoke("sc_login_start"),
  scLoginCancel: () => invoke("sc_login_cancel"),
  scLoginToken: (token: string) => invoke<ScAccountInfo>("sc_login_token", { token }),
  scAccount: () => invoke<ScAccountInfo | null>("sc_account"),
  scLogout: () => invoke("sc_logout"),
  scLibrary: (kind: "songs" | "playlists" | "history") => invoke<RPage>("sc_library", { kind }),
  scPlaylist: (id: string) => invoke<RPage>("sc_playlist", { id }),
  scRate: (trackId: string, like: boolean) => invoke("sc_rate", { trackId, like }),
  otherHome: (provider: string) => invoke<RSection[]>("other_home", { provider }),
  spStatus: () => invoke<SpStatus>("sp_status"),
  spLoginStart: (clientId?: string | null) => invoke("sp_login_start", { clientId: clientId || null }),
  spLoginCancel: () => invoke("sp_login_cancel"),
  spAccount: () => invoke<ScAccountInfo | null>("sp_account"),
  spLogout: () => invoke("sp_logout"),
  spLibrary: (kind: "songs" | "playlists" | "albums" | "artists" | "history") => invoke<RPage>("sp_library", { kind }),
  spPage: (id: string) => invoke<RPage>("sp_page", { id }),
  spRate: (trackId: string, like: boolean) => invoke("sp_rate", { trackId, like }),
  /** Página de uma coleção de qualquer fonte, pelo prefixo do id (`sc:`, `sp:` ou YouTube Music). */
  page: (id: string) => (id.startsWith("sc:") ? invoke<RPage>("sc_playlist", { id }) : id.startsWith("sp:") ? invoke<RPage>("sp_page", { id }) : invoke<RPage>("yt_page", { browseId: id })),
  ytHome: (chip?: RChip | null, continuation?: string | null) => invoke<RHome>("yt_home", { chipBrowseId: chip?.browseId, chipParams: chip?.params, continuation }),
  ytPage: (browseId: string) => invoke<RPage>("yt_page", { browseId }),
  ytRadio: (videoId?: string | null, playlistId?: string | null) => invoke<ExtInfo[]>("yt_radio", { videoId, playlistId }),
  cacheStats: () => invoke<{ bytes: number; entries: number; limit: number; enabled: boolean }>("cache_stats"),
  cacheClear: () => invoke("cache_clear"),
  cacheConfigure: (limitMb?: number, enabled?: boolean) => invoke("cache_configure", { limitMb, enabled }),
};
