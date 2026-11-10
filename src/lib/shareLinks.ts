// Links de compartilhamento: o endereço público de cada serviço, o link universal (song.link) e os atalhos dos apps de mensagem.
// Funções puras (testadas em scripts/tests/shareLinks.test.mjs); quem resolve o id real é o diálogo.

export type ShareKind = "track" | "album" | "artist" | "playlist";
export interface ShareRef { kind: ShareKind; id: string; provider?: string; /** endereço público já conhecido (SoundCloud, JioSaavn) */ url?: string | null }

const https = (u?: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

/** Endereço público da música/álbum/artista/playlist, ou `null` quando não existe (arquivo local, playlist sua, demonstração). */
export function publicUrl(r: ShareRef): string | null {
  if (r.kind === "track") {
    if (r.provider === "youtube" && /^[\w-]{11}$/.test(r.id)) return `https://music.youtube.com/watch?v=${r.id}`;
    if (r.provider === "spotify" && /^[A-Za-z0-9]{10,30}$/.test(r.id)) return `https://open.spotify.com/track/${r.id}`;
    if (r.provider === "soundcloud" || r.provider === "jiosaavn") return https(r.url);
    return null;
  }
  // coleções: o id diz de onde vêm
  const sp = /^sp:(album|playlist|artist):([A-Za-z0-9]+)$/.exec(r.id);
  if (sp) return `https://open.spotify.com/${sp[1]}/${sp[2]}`;
  if (/^MPRE[\w-]+$/.test(r.id)) return `https://music.youtube.com/browse/${r.id}`;
  if (/^UC[\w-]{20,}$/.test(r.id)) return `https://music.youtube.com/channel/${r.id}`;
  if (/^VL[\w-]+$/.test(r.id)) return `https://music.youtube.com/playlist?list=${r.id.slice(2)}`;
  if (/^(PL|RD|OLAK5uy|LM|UU)[\w-]+$/.test(r.id)) return `https://music.youtube.com/playlist?list=${r.id}`;
  return null;
}

/** Link universal (Odesli): quem recebe escolhe em que serviço abrir. Só serve para músicas e álbuns de serviços conhecidos. */
export function universalUrl(url: string | null, kind: ShareKind): string | null {
  if (!url || (kind !== "track" && kind !== "album")) return null;
  return /^https:\/\/(music\.youtube\.com|www\.youtube\.com|open\.spotify\.com|soundcloud\.com)\//i.test(url) ? `https://song.link/${url}` : null;
}

export const shareText = (title: string, url: string) => `${title}\n${url}`;
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const telegramUrl = (url: string, text: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
export const mailUrl = (subject: string, body: string) => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
