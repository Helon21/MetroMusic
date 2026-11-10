// Arte animada (Spotify Canvas): busca o vídeo em loop da faixa que toca, se a conta do Spotify estiver conectada.
import { useEffect, useState } from "react";
import { invoke, isTauri } from "./native";
import { getSetting, useSetting } from "../store/settings";
import type { Track } from "./catalog";

const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

async function fetchCanvas(t: Track): Promise<string | null> {
  if (!t.ext) return null;
  if (cache.has(t.id)) return cache.get(t.id)!;
  let p = pending.get(t.id);
  if (!p) {
    p = invoke<string | null>("spotify_canvas", { track: t.ext }).then((u) => u ?? null).catch(() => null)
      .then((u) => { cache.set(t.id, u); pending.delete(t.id); return u; });
    pending.set(t.id, p);
  }
  return p;
}

/** Endereço do vídeo do Canvas da faixa, ou `null` (sem Canvas, opção desligada, fora do app nativo ou Spotify desconectado). */
export function useCanvas(t?: Track | null): string | null {
  const on = useSetting<boolean>("spotifyCanvas") !== false && useSetting<boolean>("animatedCovers") !== false;
  const [url, setUrl] = useState<string | null>(() => (t && cache.get(t.id)) || null);
  useEffect(() => {
    if (!on || !isTauri || !t) { setUrl(null); return; }
    let alive = true;
    setUrl(cache.get(t.id) ?? null);
    fetchCanvas(t).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [t?.id, on]);
  return url;
}

export const canvasEnabled = () => getSetting("spotifyCanvas") !== false && getSetting("animatedCovers") !== false;
