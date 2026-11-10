// Cores e brilho da capa, lidos de uma miniatura (o servidor de imagens do YouTube/SoundCloud permite leitura: CORS aberto).
import { useEffect, useState } from "react";

export interface Tone { /** 0 (escura) a 1 (clara) */ light: number; /** até 3 cores vivas da capa, como `oklch`-compatíveis em HSL */ colors: string[] }

const cache = new Map<string, Tone | null>();

/** Núcleo puro: recebe pixels RGBA e devolve brilho médio e as cores mais marcantes. */
export function toneFromPixels(data: ArrayLike<number>): Tone {
  let sum = 0, n = 0;
  const buckets = new Map<string, { h: number; s: number; l: number; w: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b; n++;
    if (d < 0.08 || l < 0.12 || l > 0.92) continue; // cinza, preto e branco não definem a cor
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const key = `${Math.floor(h / 30)}`;
    const e = buckets.get(key) ?? { h: 0, s: 0, l: 0, w: 0 };
    const w = s * (1 - Math.abs(2 * l - 1)) + 0.05;
    e.h += h * w; e.s += s * w; e.l += l * w; e.w += w; buckets.set(key, e);
  }
  const colors = [...buckets.values()].sort((a, b) => b.w - a.w).slice(0, 3).map((e) => `hsl(${Math.round(e.h / e.w)} ${Math.round(Math.min(1, e.s / e.w) * 100)}% ${Math.round(Math.min(0.62, Math.max(0.38, e.l / e.w)) * 100)}%)`);
  return { light: n ? sum / n : 0.3, colors };
}

export function loadTone(url: string): Promise<Tone | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url)!);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 24;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 24, 24);
        const t = toneFromPixels(ctx.getImageData(0, 0, 24, 24).data);
        cache.set(url, t); resolve(t);
      } catch { cache.set(url, null); resolve(null); } // imagem sem CORS: fica no padrão
    };
    img.onerror = () => { cache.set(url, null); resolve(null); };
    img.src = url;
  });
}

/** Brilho e cores da capa (ou `null` enquanto carrega ou se não for possível ler). */
export function useCoverTone(url?: string, enabled = true): Tone | null {
  const [tone, setTone] = useState<Tone | null>(() => (url && cache.get(url)) || null);
  useEffect(() => {
    if (!enabled || !url) { setTone(null); return; }
    let on = true;
    loadTone(url).then((t) => on && setTone(t));
    return () => { on = false; };
  }, [url, enabled]);
  return tone;
}
