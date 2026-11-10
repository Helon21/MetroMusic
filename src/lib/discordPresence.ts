// Monta a atividade do Discord a partir da faixa e das configurações. Função pura (testada com `node --test`).

export interface PresenceInput {
  title: string; artist: string; album: string; art?: string; duration: number; position: number; playing: boolean;
  provider?: string; sourceId?: string; format?: string; bitrate?: string;
}
export interface PresenceCfg {
  appId: string; activity: string; useDetails: boolean; showProvider: boolean; playbackDetails: boolean;
  advanced: boolean; name: string; btn1: string; btn2: string; btn2Url: string;
}
export interface Presence {
  appId: string; kind: string; name?: string; details?: string; state?: string; startMs?: number; endMs?: number;
  largeImage?: string; largeText?: string; buttons: [string, string][];
}

/** Application ID do app "MetroMusic" no Discord. É público (só identifica o app); vale para todos os usuários. */
export const DEFAULT_DISCORD_APP_ID = "1569743605659074601";

export const PROVIDER_NAMES: Record<string, string> = { youtube: "YouTube Music", soundcloud: "SoundCloud", spotify: "Spotify", deezer: "Deezer" };

/** Página da faixa no serviço de origem (para o botão "Ouvir"). */
export function trackUrl(provider?: string, id?: string): string | undefined {
  if (!provider || !id) return undefined;
  if (provider === "youtube") return `https://music.youtube.com/watch?v=${encodeURIComponent(id)}`;
  if (provider === "spotify") return `https://open.spotify.com/track/${encodeURIComponent(id)}`;
  if (provider === "deezer") return `https://www.deezer.com/track/${encodeURIComponent(id)}`;
  return undefined; // SoundCloud usa o link permanente, que o catálogo não guarda
}

const fill = (s: string, i: PresenceInput) => s.replaceAll("{song_name}", i.title).replaceAll("{artist_name}", i.artist).replaceAll("{album_name}", i.album);

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * `null` = limpar a atividade (nada na fila). Tocando, o Discord mostra a barra de progresso (início e fim);
 * pausado, a atividade fica sem tempos (a barra para de andar) e o estado diz "⏸ Pausado em 1:23 de 3:00".
 */
export function buildPresence(i: PresenceInput | null, c: PresenceCfg, now = Date.now()): Presence | null {
  if (!i || !c.appId.trim()) return null;
  const paused = !i.playing;
  const providerName = PROVIDER_NAMES[i.provider ?? ""] ?? "MetroMusic";
  const startMs = Math.round(now - i.position * 1000);
  const extra = [i.album, c.showProvider ? `via ${providerName}` : "", c.playbackDetails ? [i.format, i.bitrate].filter(Boolean).join(" · ") : ""].filter(Boolean).join(" · ");
  const url = trackUrl(i.provider, i.sourceId);
  const buttons: [string, string][] = [];
  const label1 = c.advanced && c.btn1.trim() ? fill(c.btn1, i) : `Ouvir no ${providerName}`;
  if (url) buttons.push([label1, url]);
  if (c.advanced && c.btn2.trim() && c.btn2Url.trim()) buttons.push([fill(c.btn2, i), c.btn2Url.trim()]);
  return {
    appId: c.appId.trim(), kind: c.activity || "listening",
    name: c.advanced && c.name.trim() ? c.name.trim() : "MetroMusic",
    details: c.useDetails ? i.title : i.artist,
    state: paused ? `⏸ Pausado em ${mmss(i.position)}${i.duration > 0 ? ` de ${mmss(i.duration)}` : ""} · ${c.useDetails ? i.artist : i.title}` : (c.useDetails ? i.artist : i.title),
    startMs: paused ? undefined : startMs, endMs: !paused && i.duration > 0 ? startMs + Math.round(i.duration * 1000) : undefined,
    largeImage: i.art?.startsWith("https://") ? i.art : undefined, largeText: extra || undefined, buttons,
  };
}
