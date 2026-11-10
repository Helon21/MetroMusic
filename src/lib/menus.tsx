import { useLT } from "./lt/session";
import { CircleUser, Copy, Disc3, Download, FileDown, Heart, HeartOff, Info, ListEnd, ListPlus, ListStart, Pencil, Pin, PinOff, Play, Plus, Radio, RefreshCw, Share2, Shuffle, Trash2, Waypoints, Image, Clock, CloudUpload, Podcast, Users, BookmarkPlus, BookmarkCheck, Import } from "lucide-react";
import { accountProviderOf, addToAccountPlaylist, loggedIn, providerName, refreshAccountPlaylists, removeFromAccountPlaylist, useAccountPlaylists } from "./accountPlaylists";
import { artistTracks, getAlbum, getArtist, getTracks, type Album, type Artist, type Playlist, type Track } from "./catalog";
import { copyText } from "./util";
import { useLib, type Pin as PinT } from "../store/library";
import { usePlayer } from "../store/player";
import { nav, openDialog, toast, type MenuItem } from "../store/ui";

const div: MenuItem = { divider: true };
const P = () => usePlayer.getState();
const L = () => useLib.getState();

/** Playlists da conta (YouTube Music / Spotify) em que as faixas podem entrar, quando elas são desse serviço. */
function accountPlaylistItems(ids: string[]): MenuItem[] {
  const p = accountProviderOf(ids);
  if (!p || !loggedIn(p)) return [];
  const st = useAccountPlaylists.getState();
  const list = st.lists[p];
  if (list === null && !st.loading[p]) void refreshAccountPlaylists(p); // primeira vez: carrega; aparece na próxima abertura do menu
  return [
    div,
    { label: providerName(p), header: true },
    ...(p === "youtube" ? [{ label: "Nova playlist no YouTube Music…", icon: <Plus />, onClick: () => openDialog("createPlaylist", { trackIds: ids, account: p }) } as MenuItem] : []),
    ...(list === null ? [{ label: "Carregando playlists da conta…", disabled: true } as MenuItem]
      : list.length ? list.map((c): MenuItem => ({ label: c.title, onClick: () => addToAccountPlaylist(p, c, ids) }))
      : [{ label: "Nenhuma playlist editável na conta", disabled: true } as MenuItem]),
  ];
}

function playlistSub(ids: string[]): MenuItem[] {
  return [
    { label: "Nova playlist…", icon: <Plus />, onClick: () => openDialog("createPlaylist", { trackIds: ids }) },
    div,
    ...L().playlists.map((p): MenuItem => ({ label: p.title, onClick: () => addTo(p.id, ids) })),
    ...accountPlaylistItems(ids),
  ];
}
export function addTo(playlistId: string, ids: string[]) {
  const p = L().playlists.find((x) => x.id === playlistId); if (!p) return;
  const dup = ids.filter((i) => p.trackIds.includes(i));
  if (dup.length) return openDialog("duplicates", { playlistId, ids, dup });
  L().addToPlaylist(playlistId, ids);
  toast(`Adicionada a ${p.title}`, { label: "Abrir", fn: () => nav(`playlist/${playlistId}`) });
}
function pinItem(p: PinT): MenuItem {
  const on = L().pins.some((x) => x.id === p.id);
  return { label: on ? "Desafixar do acesso rápido" : "Fixar no acesso rápido", icon: on ? <PinOff /> : <Pin />, onClick: () => { L().togglePin(p); toast(on ? "Removido do acesso rápido" : "Fixado no acesso rápido"); } };
}
function downloadItem(ids: string[]): MenuItem {
  const d = L().downloads; const all = ids.every((i) => d[i] >= 1); const busy = ids.some((i) => i in d && d[i] < 1);
  if (busy) return { label: "Baixando…", icon: <Download />, disabled: true };
  return all
    ? { label: "Remover download", icon: <Trash2 />, onClick: () => { L().removeDownload(ids); toast("Download removido"); } }
    : { label: "Baixar", icon: <Download />, hint: ids.length > 1 ? String(ids.length) : undefined, onClick: () => { L().download(ids); toast(ids.length > 1 ? `Baixando ${ids.length} músicas` : "Baixando…"); } };
}
const share = (title: string, kind: string, id: string): MenuItem => ({ label: "Compartilhar", icon: <Share2 />, sub: [
  { label: "Copiar link", icon: <Copy />, onClick: () => { copyText(`https://metromusic.app/${kind}/${id}`); toast("Link copiado"); } },
  { label: "Mais opções…", icon: <Share2 />, onClick: () => openDialog("share", { title, kind, id }) },
] });

/** `remote`: a faixa está numa playlist da conta aberta na tela (permite remover dela). */
export interface TrackCtx { remote?: { provider: "youtube" | "spotify"; playlistId: string }; playlistId?: string; queueIndex?: number; historyAt?: number; cache?: boolean; inRoom?: boolean }

export function trackMenu(t: Track, ctx: TrackCtx = {}): MenuItem[] {
  const liked = L().liked.includes(t.id);
  const own = ctx.playlistId && L().playlists.some((p) => p.id === ctx.playlistId);
  const later = L().later.includes(t.id);
  return [
    { label: "Tocar a seguir", icon: <ListStart />, onClick: () => P().playNext([t.id]) },
    { label: "Adicionar à fila", icon: <ListEnd />, onClick: () => P().addToQueue([t.id]) },
    ...(t.episode ? [] : [{ label: "Iniciar rádio", icon: <Radio />, onClick: () => P().startRadio(t.id) }]),
    div,
    { label: liked ? "Remover curtida" : "Curtir", icon: liked ? <HeartOff /> : <Heart />, hint: "L", onClick: () => L().toggleLike(t.id) },
    { label: "Adicionar à playlist", icon: <ListPlus />, sub: playlistSub([t.id]) },
    downloadItem([t.id]),
    ...(t.episode ? [{ label: later ? "Remover dos salvos" : "Salvar para depois", icon: later ? <BookmarkCheck /> : <BookmarkPlus />, onClick: () => L().toggleLater(t.id) }] : [pinItem({ type: "track", id: t.id })]),
    div,
    ...(t.episode
      ? [{ label: "Ver podcast", icon: <Podcast />, onClick: () => nav(`podcast/${t.podcastId}`) }]
      : [{ label: "Ir para o artista", icon: <CircleUser />, onClick: () => nav(`artist/${t.artistId}`) }, { label: "Ir para o álbum", icon: <Disc3 />, onClick: () => nav(`album/${t.albumId}`) }]),
    share(t.title, "track", t.id),
    { label: "Escolher fonte de áudio", icon: <Waypoints />, onClick: () => openDialog("source", { id: t.id }) },
    ...(ctx.inRoom || useLT.getState().role === "guest" ? [{ label: "Sugerir ao anfitrião", icon: <Users />, onClick: () => useLT.getState().suggest(t.id) }] : []),
    div,
    { label: "Editar", icon: <Pencil />, onClick: () => openDialog("editSong", { id: t.id }) },
    { label: "Atualizar metadados", icon: <RefreshCw />, onClick: () => toast("Metadados atualizados") },
    { label: "Detalhes", icon: <Info />, onClick: () => openDialog("details", { id: t.id }) },
    ...(own ? [div, { label: "Remover desta playlist", icon: <Trash2 />, danger: true, onClick: () => { const prev = L().playlists.find((p) => p.id === ctx.playlistId)!.trackIds; L().removeFromPlaylist(ctx.playlistId!, [t.id]); toast(`"${t.title}" removida da playlist`, { label: "Desfazer", fn: () => L().updatePlaylist(ctx.playlistId!, { trackIds: prev }) }); } }] : []),
    ...(ctx.remote ? [div, { label: "Remover desta playlist", icon: <Trash2 />, danger: true, onClick: () => removeFromAccountPlaylist(ctx.remote!.provider, ctx.remote!.playlistId, t.id) }] : []),
    ...(ctx.queueIndex !== undefined && ctx.queueIndex !== P().index ? [div, { label: "Remover da fila", icon: <Trash2 />, danger: true, onClick: () => P().remove(ctx.queueIndex!) }] : []),
    ...(ctx.historyAt ? [div, { label: "Remover do histórico", icon: <Trash2 />, danger: true, onClick: () => L().removeHistory(ctx.historyAt!) }] : []),
    ...(ctx.cache ? [div, { label: "Remover do cache", icon: <Trash2 />, danger: true, onClick: () => { useLib.setState((s) => ({ cached: s.cached.filter((c) => c !== t.id) })); toast("Removida do cache"); } }] : []),
  ];
}

export function tracksMenu(ids: string[], ctx: TrackCtx = {}): MenuItem[] {
  const allLiked = ids.every((i) => L().liked.includes(i));
  const own = ctx.playlistId && L().playlists.some((p) => p.id === ctx.playlistId);
  return [
    { header: true, label: `${ids.length} selecionadas` },
    { label: "Tocar", icon: <Play />, onClick: () => P().play(ids, 0, "Seleção") },
    { label: "Embaralhar", icon: <Shuffle />, onClick: () => P().play(ids, 0, "Seleção", { shuffle: true }) },
    { label: "Tocar a seguir", icon: <ListStart />, onClick: () => P().playNext(ids) },
    { label: "Adicionar à fila", icon: <ListEnd />, onClick: () => P().addToQueue(ids) },
    div,
    { label: allLiked ? "Remover curtidas" : "Curtir todas", icon: allLiked ? <HeartOff /> : <Heart />, onClick: () => L().setLiked(ids, !allLiked) },
    { label: "Adicionar à playlist", icon: <ListPlus />, sub: playlistSub(ids) },
    downloadItem(ids),
    ...(own ? [div, { label: "Remover desta playlist", icon: <Trash2 />, danger: true, onClick: () => { L().removeFromPlaylist(ctx.playlistId!, ids); toast(`${ids.length} músicas removidas`); } }] : []),
  ];
}

export function albumMenu(a: Album): MenuItem[] {
  const saved = L().savedAlbums.includes(a.id);
  return [
    { label: "Tocar", icon: <Play />, onClick: () => P().play(a.trackIds, 0, a.title) },
    { label: "Embaralhar", icon: <Shuffle />, onClick: () => P().play(a.trackIds, 0, a.title, { shuffle: true }) },
    { label: "Tocar a seguir", icon: <ListStart />, onClick: () => P().playNext(a.trackIds) },
    { label: "Adicionar à fila", icon: <ListEnd />, onClick: () => P().addToQueue(a.trackIds) },
    { label: "Iniciar rádio", icon: <Radio />, onClick: () => P().startRadio(a.trackIds[0]) },
    div,
    { label: saved ? "Remover da biblioteca" : "Adicionar à biblioteca", icon: saved ? <BookmarkCheck /> : <BookmarkPlus />, onClick: () => { L().toggleAlbum(a.id); toast(saved ? "Removido da biblioteca" : "Adicionado à biblioteca"); } },
    { label: "Adicionar à playlist", icon: <ListPlus />, sub: playlistSub(a.trackIds) },
    downloadItem(a.trackIds),
    pinItem({ type: "album", id: a.id }),
    div,
    { label: "Ir para o artista", icon: <CircleUser />, onClick: () => nav(`artist/${a.artistId}`) },
    share(a.title, "album", a.id),
    { label: "Atualizar metadados", icon: <RefreshCw />, onClick: () => toast("Metadados atualizados") },
  ];
}

export function artistMenu(a: Artist): MenuItem[] {
  const ids = artistTracks(a.id).map((t) => t.id);
  const on = L().followed.includes(a.id);
  return [
    { label: "Tocar", icon: <Play />, onClick: () => P().play(ids, 0, a.name) },
    { label: "Embaralhar", icon: <Shuffle />, onClick: () => P().play(ids, 0, a.name, { shuffle: true }) },
    { label: "Iniciar rádio", icon: <Radio />, onClick: () => P().startRadio(ids[0]) },
    { label: "Adicionar à fila", icon: <ListEnd />, onClick: () => P().addToQueue(ids.slice(0, 20)) },
    div,
    { label: on ? "Deixar de seguir" : "Seguir", icon: on ? <HeartOff /> : <Heart />, onClick: () => L().toggleFollow(a.id) },
    pinItem({ type: "artist", id: a.id }),
    { label: "Editar nome", icon: <Pencil />, onClick: () => openDialog("editArtist", { id: a.id }) },
    share(a.name, "artist", a.id),
  ];
}

export function playlistMenu(p: Playlist): MenuItem[] {
  const own = L().playlists.some((x) => x.id === p.id);
  const saved = L().savedPlaylists.includes(p.id);
  const ids = p.trackIds;
  return [
    { label: "Tocar", icon: <Play />, disabled: !ids.length, onClick: () => P().play(ids, 0, p.title) },
    { label: "Embaralhar", icon: <Shuffle />, disabled: !ids.length, onClick: () => P().play(ids, 0, p.title, { shuffle: true }) },
    { label: "Tocar a seguir", icon: <ListStart />, disabled: !ids.length, onClick: () => P().playNext(ids) },
    { label: "Adicionar à fila", icon: <ListEnd />, disabled: !ids.length, onClick: () => P().addToQueue(ids) },
    ...(ids.length ? [{ label: "Iniciar rádio", icon: <Radio />, onClick: () => P().startRadio(ids[0]) }] : []),
    div,
    ...(own ? [
      { label: "Editar detalhes", icon: <Pencil />, onClick: () => openDialog("editPlaylist", { id: p.id }) },
      { label: "Trocar a capa", icon: <Image />, onClick: () => openDialog("editCover", { id: p.id }) },
      { label: p.synced ? "Sincronizar agora" : "Ativar sincronização", icon: <CloudUpload />, onClick: () => { if (!p.synced) L().updatePlaylist(p.id, { synced: true }); toast("Playlist sincronizada"); } },
    ] : p.kind !== "auto" ? [
      { label: saved ? "Remover da biblioteca" : "Salvar na biblioteca", icon: saved ? <BookmarkCheck /> : <BookmarkPlus />, onClick: () => { L().toggleSavedPlaylist(p.id); toast(saved ? "Removida da biblioteca" : "Salva na biblioteca"); } },
      { label: "Importar como playlist local", icon: <Import />, onClick: () => { const id = L().createPlaylist(p.title, [...ids]); toast("Playlist importada", { label: "Abrir", fn: () => nav(`playlist/${id}`) }); } },
    ] : []),
    { label: "Adicionar a outra playlist", icon: <ListPlus />, disabled: !ids.length, sub: playlistSub(ids) },
    ...(ids.length ? [downloadItem(ids)] : []),
    { label: "Curtir todas", icon: <Heart />, disabled: !ids.length, onClick: () => { L().setLiked(ids, true); toast("Todas curtidas"); } },
    ...(p.kind !== "auto" || own ? [pinItem({ type: "playlist", id: p.id })] : [pinItem({ type: "playlist", id: p.id })]),
    div,
    { label: "Exportar", icon: <FileDown />, disabled: !ids.length, sub: [
      { label: "Como CSV", onClick: () => toast(`"${p.title}.csv" salvo em Documentos`) },
      { label: "Como M3U", onClick: () => toast(`"${p.title}.m3u" salvo em Documentos`) },
    ] },
    ...(p.kind === "auto" ? [] : [share(p.title, "playlist", p.id)]),
    ...(own ? [div, { label: "Apagar playlist", icon: <Trash2 />, danger: true, onClick: () => openDialog("confirm", { title: "Apagar playlist?", text: `"${p.title}" será apagada para sempre. As músicas continuam na sua biblioteca.`, confirm: "Apagar", danger: true, action: () => { L().deletePlaylist(p.id); nav("library/playlists"); toast("Playlist apagada"); } }) }] : []),
  ];
}

export const sleepMenu = (): MenuItem[] => {
  const s = P().sleep;
  const set = (min: number) => () => { P().setSleep({ endsAt: Date.now() + min * 60000 }); toast(`Timer de sono: ${min} minutos`); };
  return [
    { header: true, label: "Timer de sono" },
    ...[5, 15, 30, 45, 60, 90].map((m): MenuItem => ({ label: `${m} minutos`, icon: <Clock />, onClick: set(m) })),
    { label: "Fim da música", checked: !!s?.endOfSong, onClick: () => { P().setSleep({ endOfSong: true }); toast("Timer de sono: para no fim desta música"); } },
    { label: "Personalizar…", onClick: () => openDialog("sleep") },
    ...(s ? [div, { label: "Desativar timer", danger: true, onClick: () => { P().setSleep(null); toast("Timer de sono desativado"); } }] : []),
  ];
};

export const tracksOfAlbum = (id: string) => getTracks(getAlbum(id)?.trackIds ?? []);
export const artistName = (id: string) => getArtist(id)?.name ?? "";
