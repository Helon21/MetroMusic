// Ponte da interface com o backend de áudio (src-tauri). Fora do Tauri, `backend` é falso e o app
// usa só o catálogo de demonstração e o simulador de reprodução.

import { invoke, isTauri } from "./native";
import { getSetting } from "../store/settings";
import type { ExtInfo } from "./catalog";

export const backend = isTauri;

/** Provedores que tocam músicas inteiras, na ordem em que o app tenta achar a mesma faixa (para o Deezer). */
export function playbackOrder(): string[] {
  const saved: string[] = getSetting("providerOrder") ?? [];
  const off: string[] = getSetting("providerOff") ?? [];
  const order = saved.filter((p) => (p === "youtube" || p === "soundcloud") && !off.includes(p));
  return order.length ? order : ["youtube", "soundcloud"].filter((p) => !off.includes(p));
}

export const SEARCHABLE = ["youtube", "soundcloud", "deezer"];

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
  cacheStats: () => invoke<{ bytes: number; entries: number; limit: number; enabled: boolean }>("cache_stats"),
  cacheClear: () => invoke("cache_clear"),
  cacheConfigure: (limitMb?: number, enabled?: boolean) => invoke("cache_configure", { limitMb, enabled }),
};
