import { useEffect } from "react";
import { create } from "zustand";
import { extLyrics, type Lyrics, type Track } from "./catalog";
import { engine } from "./engine";
import { getSetting } from "../store/settings";
import { LYRICS_PROVIDERS } from "./settingsSchema";

/** Letras reais (faixas com `ext`). `version` muda quando chega uma letra nova, para os componentes recalcularem. */
interface S { version: number; loading: Record<string, boolean>; bump: () => void }
export const useLyricsStore = create<S>((set) => ({ version: 0, loading: {}, bump: () => set((s) => ({ version: s.version + 1 })) }));

const inFlight = new Set<string>();

function lyricsOrder(): string[] {
  const saved: string[] = getSetting("lyricsOrder") ?? Object.keys(LYRICS_PROVIDERS);
  const off: string[] = getSetting("lyricsOff") ?? [];
  return saved.filter((p) => !off.includes(p));
}

/** Busca a letra no backend, uma vez por faixa (`force` ignora o que já foi achado). */
export async function ensureLyrics(track: Track, force = false) {
  if (!track.ext) return;
  const id = track.id;
  if ((extLyrics.has(id) && !force) || inFlight.has(id)) return;
  inFlight.add(id);
  useLyricsStore.setState((s) => ({ loading: { ...s.loading, [id]: true } }));
  try {
    const l = await engine.lyrics(track.ext, lyricsOrder());
    extLyrics.set(id, (l as Lyrics | null) ?? null);
  } catch {
    extLyrics.set(id, null);
  } finally {
    inFlight.delete(id);
    useLyricsStore.setState((s) => ({ loading: { ...s.loading, [id]: false }, version: s.version + 1 }));
  }
}

/** Dispara a busca e assina as atualizações; devolve se ainda está carregando. */
export function useRealLyrics(track: Track): { version: number; loading: boolean } {
  const version = useLyricsStore((s) => s.version);
  const loading = useLyricsStore((s) => !!track.ext && (s.loading[track.id] ?? !extLyrics.has(track.id)));
  useEffect(() => { void ensureLyrics(track); }, [track.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { version, loading };
}
