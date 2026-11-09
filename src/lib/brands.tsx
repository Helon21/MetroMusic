// Logotipos oficiais das fontes e integrações. Os arquivos SVG ficam em src/assets/brands
// (origem e licença em src/assets/brands/README.md).
//
// - Marcas de uma cor só são desenhadas inline na cor oficial (a TIDAL, que é preta,
//   acompanha a cor do texto para continuar visível no tema escuro).
// - Marcas de várias cores (Qobuz, JioSaavn, Musixmatch) entram como imagem, como são.

import { HardDrive } from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "./util";
import applemusic from "../assets/brands/applemusic.svg?raw";
import deezer from "../assets/brands/deezer.svg?raw";
import discord from "../assets/brands/discord.svg?raw";
import jiosaavn from "../assets/brands/jiosaavn.svg?url";
import lastfm from "../assets/brands/lastfm.svg?raw";
import musixmatch from "../assets/brands/musixmatch.svg?url";
import qobuz from "../assets/brands/qobuz.svg?url";
import soundcloud from "../assets/brands/soundcloud.svg?raw";
import spotify from "../assets/brands/spotify.svg?raw";
import tidal from "../assets/brands/tidal.svg?raw";
import youtubemusic from "../assets/brands/youtubemusic.svg?raw";

export type BrandId = "youtube" | "tidal" | "spotify" | "soundcloud" | "deezer" | "jiosaavn" | "qobuz" | "discord" | "lastfm" | "applemusic" | "musixmatch";

interface Brand { name: string; color: string; svg?: string; url?: string }
const bare = (svg: string) => svg.replace(/<title>.*?<\/title>/, "");

export const BRANDS: Record<BrandId, Brand> = {
  youtube: { name: "YouTube Music", color: "#FF0000", svg: bare(youtubemusic) },
  tidal: { name: "TIDAL", color: "currentColor", svg: bare(tidal) },
  spotify: { name: "Spotify", color: "#1ED760", svg: bare(spotify) },
  soundcloud: { name: "SoundCloud", color: "#FF5500", svg: bare(soundcloud) },
  deezer: { name: "Deezer", color: "#A238FF", svg: bare(deezer) },
  discord: { name: "Discord", color: "#5865F2", svg: bare(discord) },
  lastfm: { name: "Last.fm", color: "#D51007", svg: bare(lastfm) },
  applemusic: { name: "Apple Music", color: "#FA243C", svg: bare(applemusic) },
  jiosaavn: { name: "JioSaavn", color: "#1ECCB0", url: jiosaavn },
  qobuz: { name: "Qobuz", color: "currentColor", url: qobuz },
  musixmatch: { name: "Musixmatch", color: "#F7506A", url: musixmatch },
};
export const isBrand = (id: string): id is BrandId => id in BRANDS;

export function BrandIcon({ id, size = 20, className, style }: { id: BrandId; size?: number; className?: string; style?: CSSProperties }) {
  const b = BRANDS[id];
  const box: CSSProperties = { width: size, height: size, ...style };
  if (b.url) return <img src={b.url} alt="" draggable={false} className={cx("shrink-0 object-contain", className)} style={box} />;
  return <span aria-hidden className={cx("inline-block shrink-0 [&>svg]:size-full [&>svg]:fill-current", className)} style={{ ...box, color: b.color }} dangerouslySetInnerHTML={{ __html: b.svg! }} />;
}

/** Marca sobre um fundo levemente tingido com a cor oficial. */
export function BrandTile({ id, size = 44, className }: { id: BrandId; size?: number; className?: string }) {
  const b = BRANDS[id];
  const tint = b.color === "currentColor" ? "var(--s3)" : `color-mix(in oklch, ${b.color} 18%, var(--s2))`;
  return (
    <span className={cx("grid place-items-center shrink-0", className ?? "rounded-xl")} style={{ width: size, height: size, background: tint }}>
      <BrandIcon id={id} size={Math.round(size * 0.54)} />
    </span>
  );
}

/** Fontes de áudio do app -> marca. `offline` não tem marca. */
export const sourceBrand = (id: string): BrandId | null => ({ youtube: "youtube", tidal: "tidal", spotify: "spotify", soundcloud: "soundcloud", deezer: "deezer", jiosaavn: "jiosaavn", qobuz: "qobuz" } as Record<string, BrandId>)[id] ?? null;

/** Provedores de letra com marca própria. */
export const lyricsBrand = (id: string): BrandId | null => ({ apple: "applemusic", musixmatch: "musixmatch", deezer: "deezer", spotify: "spotify", youtube: "youtube" } as Record<string, BrandId>)[id] ?? null;

/** Marca da fonte ou, para o que não tem (arquivos locais), um ícone genérico. */
export function SourceIcon({ id, size = 20, className }: { id: string; size?: number; className?: string }) {
  const b = sourceBrand(id);
  return b ? <BrandIcon id={b} size={size} className={className} /> : <HardDrive className={cx("text-t2 shrink-0", className)} style={{ width: size, height: size }} />;
}
