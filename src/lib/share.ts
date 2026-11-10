// Compartilhar: resolve o endereço real do que o usuário quer enviar e abre os apps de mensagem.
import { getTrack, realAlbumId, realArtistId, artistOf } from "./catalog";
import { publicUrl, shareText, universalUrl, type ShareKind, type ShareRef } from "./shareLinks";
import { invoke, isTauri } from "./native";
import { copyText } from "./util";
import { resolvePlaylist } from "../store/library";
import { toast } from "../store/ui";

/** O que a interface chama de música/álbum/artista/playlist → referência com o id do serviço de origem. */
export function shareRef(kind: string, id: string): ShareRef {
  const k = (["track", "album", "artist", "playlist"].includes(kind) ? kind : "track") as ShareKind;
  if (k === "track") {
    const e = getTrack(id)?.ext;
    return e ? { kind: k, id: e.id, provider: e.provider, url: e.url } : { kind: k, id };
  }
  // álbuns e artistas do catálogo local usam ids sintéticos; o real vem do YouTube Music
  if (k === "album") return { kind: k, id: realAlbumId(id) ?? id };
  if (k === "artist") return { kind: k, id: realArtistId(id) ?? id };
  return { kind: k, id };
}

/** Endereço público (ou `null`). */
export const linkOf = (kind: string, id: string) => publicUrl(shareRef(kind, id));
export { universalUrl };

/** Lista de músicas de uma playlist sua, como texto (uma por linha, com o link quando existir). */
export function playlistAsText(id: string, title: string): string | null {
  const ids = resolvePlaylist(id)?.trackIds ?? [];
  if (!ids.length) return null;
  const lines = ids.map((tid) => {
    const t = getTrack(tid);
    if (!t) return "";
    const u = linkOf("track", tid);
    return `${artistOf(t)} - ${t.title}${u ? ` ${u}` : ""}`;
  }).filter(Boolean);
  return `${title}\n${lines.join("\n")}`;
}

/** Abre um endereço no navegador / app de mensagem. */
export async function openExternal(url: string) {
  try {
    if (isTauri) await invoke("open_url", { url });
    else window.open(url, "_blank", "noopener");
  } catch (e) { toast(`Não consegui abrir: ${String(e).replace(/^Error: /, "")}`); }
}

export async function copyLink(kind: string, id: string, title: string) {
  const u = linkOf(kind, id);
  if (u) { copyText(u); toast("Link copiado"); return; }
  const text = kind === "playlist" ? playlistAsText(id, title) : null;
  if (text) { copyText(text); toast("Lista de músicas copiada"); return; }
  toast("Isto não tem um link público. Abra “Mais opções” para compartilhar de outro jeito.");
}

export { shareText };
