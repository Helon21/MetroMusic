// Playlists da conta (YouTube Music e Spotify): lista para o menu "Adicionar à playlist" e as operações de editar.
import { create } from "zustand";
import { getTrack } from "./catalog";
import { engine, type RCollection } from "./engine";
import { useSp } from "./spotify";
import { useYt } from "./account";
import { toast } from "../store/ui";

export type AccountProvider = "youtube" | "spotify";
interface S { lists: Record<AccountProvider, RCollection[] | null>; loading: Record<AccountProvider, boolean> }
export const useAccountPlaylists = create<S>(() => ({ lists: { youtube: null, spotify: null }, loading: { youtube: false, spotify: false } }));

export const loggedIn = (p: AccountProvider) => !!(p === "youtube" ? useYt.getState().info : useSp.getState().info);
export const providerName = (p: AccountProvider) => (p === "youtube" ? "YouTube Music" : "Spotify");

/** Provedor da conta a que todas essas faixas pertencem (ou `null`, se misturam fontes ou não são de uma conta). */
export function accountProviderOf(ids: string[]): AccountProvider | null {
  const set = new Set(ids.map((id) => getTrack(id)?.ext?.provider));
  const only = set.size === 1 ? [...set][0] : null;
  return only === "youtube" || only === "spotify" ? only : null;
}

export async function refreshAccountPlaylists(p: AccountProvider) {
  if (!loggedIn(p) || useAccountPlaylists.getState().loading[p]) return;
  useAccountPlaylists.setState((s) => ({ loading: { ...s.loading, [p]: true } }));
  try {
    const list = (await engine.playlistsEditable(p)) ?? [];
    useAccountPlaylists.setState((s) => ({ lists: { ...s.lists, [p]: list } }));
  } catch (e) { toast(`Não foi possível carregar as playlists do ${providerName(p)}: ${e}`); }
  finally { useAccountPlaylists.setState((s) => ({ loading: { ...s.loading, [p]: false } })); }
}

/** Avisa as telas abertas (página de playlist, biblioteca) que algo mudou na conta. */
export const notifyRemoteChanged = () => window.dispatchEvent(new CustomEvent("mm:remote-changed"));

const extIds = (ids: string[]) => ids.map((id) => getTrack(id)?.ext).filter((e): e is NonNullable<typeof e> => !!e);

export async function addToAccountPlaylist(p: AccountProvider, playlist: RCollection, ids: string[]) {
  try {
    await engine.playlistAdd(p, playlist.id, extIds(ids).map((e) => e.id));
    toast(ids.length > 1 ? `${ids.length} músicas adicionadas a ${playlist.title}` : `Adicionada a ${playlist.title}`);
    notifyRemoteChanged();
  } catch (e) { toast(`Não foi possível adicionar: ${e}`); }
}

export async function createAccountPlaylist(p: AccountProvider, title: string, ids: string[]): Promise<boolean> {
  try {
    await engine.playlistCreate(p, title, extIds(ids).map((e) => e.id));
    toast(`Playlist "${title}" criada no ${providerName(p)}`);
    useAccountPlaylists.setState((s) => ({ lists: { ...s.lists, [p]: null } })); // recarrega na próxima vez
    notifyRemoteChanged();
    return true;
  } catch (e) { toast(`Não foi possível criar a playlist: ${e}`); return false; }
}

export async function removeFromAccountPlaylist(p: AccountProvider, playlistId: string, trackId: string) {
  const e = getTrack(trackId)?.ext;
  if (!e) return;
  try {
    await engine.playlistRemove(p, playlistId, [{ trackId: e.id, setId: e.setId ?? null }]);
    toast("Removida da playlist");
    notifyRemoteChanged();
  } catch (err) { toast(`Não foi possível remover: ${err}`); }
}

/** O item está na biblioteca da conta agora? (leitura real; o YouTube Music pode levar alguns segundos para refletir) */
async function inLibrary(p: AccountProvider, kind: "album" | "playlist" | "artist", id: string): Promise<boolean> {
  const list = kind === "album" ? "albums" : kind === "artist" ? "artists" : "playlists";
  const page = await (p === "spotify" ? engine.spLibrary(list) : engine.ytLibrary(list));
  const bare = (x: string) => x.replace(/^VL/, "");
  return (page?.items ?? []).some((i) => i.collection && (i.collection.id === id || bare(i.collection.id) === bare(id)));
}

export async function saveToLibrary(p: AccountProvider, kind: "album" | "playlist" | "artist", id: string, save: boolean) {
  try {
    await engine.librarySave(p, kind, id, save);
  } catch (e) { toast(`Não foi possível alterar a biblioteca: ${e}`); return; }
  const done = save ? (kind === "artist" ? "Você segue este artista" : "Salvo na sua biblioteca") : (kind === "artist" ? "Você deixou de seguir" : "Removido da sua biblioteca");
  // confere de verdade lendo a biblioteca (até ~12 s)
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 2000));
    try { if ((await inLibrary(p, kind, id)) === save) { toast(`${done} · confirmado em ${providerName(p)}`); notifyRemoteChanged(); return; } } catch { /* tenta de novo */ }
  }
  toast(`${providerName(p)} aceitou, mas ainda não apareceu na biblioteca. Pode levar alguns instantes; atualize a tela depois.`);
  notifyRemoteChanged();
}
