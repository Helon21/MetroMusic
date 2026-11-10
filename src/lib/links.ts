// Links de música colados na busca: reconhece YouTube Music/YouTube e Spotify e diz para onde levam.
// (Função pura, sem depender da interface, para poder testar.)

export type MusicLink =
  | { kind: "yt-track"; id: string }
  | { kind: "yt-playlist" | "yt-album" | "yt-artist"; id: string }
  | { kind: "sp-playlist" | "sp-album" | "sp-artist" | "sp-track"; id: string };

const YT_HOSTS = new Set(["music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"]);
const ID = /^[A-Za-z0-9_-]{6,64}$/;

export function parseMusicLink(text: string): MusicLink | null {
  const raw = text.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (YT_HOSTS.has(host)) {
    if (host === "youtu.be") return ID.test(parts[0] ?? "") ? { kind: "yt-track", id: parts[0] } : null;
    const v = u.searchParams.get("v"), list = u.searchParams.get("list");
    if (parts[0] === "watch" && v && ID.test(v)) return { kind: "yt-track", id: v };
    if (parts[0] === "playlist" && list && ID.test(list)) return { kind: "yt-playlist", id: list };
    if (parts[0] === "browse" && parts[1]) return parts[1].startsWith("MPRE") ? { kind: "yt-album", id: parts[1] } : parts[1].startsWith("UC") ? { kind: "yt-artist", id: parts[1] } : parts[1].startsWith("VL") ? { kind: "yt-playlist", id: parts[1].slice(2) } : null;
    if (parts[0] === "channel" && parts[1]?.startsWith("UC")) return { kind: "yt-artist", id: parts[1] };
    return null;
  }
  if (host === "open.spotify.com") {
    // /intl-pt/track/ID também existe
    const i = /^intl-/.test(parts[0] ?? "") ? 1 : 0;
    const type = parts[i], id = parts[i + 1];
    if (!id || !/^[A-Za-z0-9]{10,30}$/.test(id)) return null;
    if (type === "track" || type === "playlist" || type === "album" || type === "artist") return { kind: `sp-${type}`, id };
  }
  return null;
}

/** Rota interna da página que o link abre (faixas não têm página: tocam). */
export function linkRoute(l: MusicLink): string | null {
  switch (l.kind) {
    case "yt-playlist": return `yt/playlist/${encodeURIComponent(`VL${l.id}`)}`;
    case "yt-album": return `yt/album/${encodeURIComponent(l.id)}`;
    case "yt-artist": return `yt/artist/${encodeURIComponent(l.id)}`;
    case "sp-playlist": case "sp-album": case "sp-artist": return `yt/${l.kind.slice(3)}/${encodeURIComponent(`sp:${l.kind.slice(3)}:${l.id}`)}`;
    default: return null;
  }
}
