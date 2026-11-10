// Abre o que um link de música aponta: páginas viram rota; faixas do YouTube tocam (com o rádio da faixa na fila).
import { linkRoute, parseMusicLink } from "./links";
import { registerTrack } from "./catalog";
import { engine } from "./engine";
import { getSetting } from "../store/settings";
import { usePlayer } from "../store/player";
import { nav, toast } from "../store/ui";

/** `true` se o texto era um link de música e foi tratado (a busca não deve seguir). */
export function openMusicLink(text: string): boolean {
  if (getSetting("openLinks") === false) return false;
  const link = parseMusicLink(text);
  if (!link) return false;
  const route = linkRoute(link);
  if (route) { nav(route); return true; }
  if (link.kind === "yt-track") {
    toast("Abrindo a faixa…");
    engine.ytRadio(link.id, null).then((list) => {
      const tracks = (list ?? []).map((t) => registerTrack(t));
      if (!tracks.length) { toast("Não encontrei essa faixa"); return; }
      // o rádio começa pela faixa do link
      usePlayer.getState().play(tracks.map((t) => t.id), 0, "Link");
    }).catch(() => toast("Não consegui abrir esse link"));
    return true;
  }
  toast("Links de faixa do Spotify ainda não tocam direto: abra o álbum ou a playlist");
  return true;
}
