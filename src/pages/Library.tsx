import { useMemo, useState } from "react";
import { ArrowDownUp, ArrowDownWideNarrow, ArrowUpNarrowWide, Import, LayoutGrid, List, Library as LibraryIcon, Plus, Search, Shuffle, Upload, Play, FolderSearch } from "lucide-react";
import { artistOf, getAlbum, getArtist, getPodcast, getTrack, getTracks, songs } from "../lib/catalog";
import { cx, fmtLong, norm } from "../lib/util";
import { AUTO, resolvePlaylist, useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { useSetting } from "../store/settings";
import { nav, openDialog, toast, useUI } from "../store/ui";
import { Grid, MediaCard, resolveItem, TrackList, type Item } from "../components/media";
import { Btn, Chip, Cover, Empty, IconBtn, SectionTitle } from "../components/ui";
import { isTauri } from "../lib/native";
import YtLibraryView from "./YtLibraryView";

const TABS: [string, string][] = [["mix", "Tudo"], ["playlists", "Playlists"], ["songs", "Músicas"], ["albums", "Álbuns"], ["artists", "Artistas"], ["podcasts", "Podcasts"]];
const SORTS: Record<string, [string, string][]> = {
  mix: [["date", "Adicionado recentemente"], ["name", "Nome"]],
  playlists: [["date", "Data de criação"], ["name", "Nome"], ["count", "Quantidade de músicas"], ["updated", "Última atualização"]],
  songs: [["date", "Data de adição"], ["name", "Nome"], ["artist", "Artista"], ["plays", "Tempo de reprodução"]],
  albums: [["date", "Data de adição"], ["name", "Nome"], ["artist", "Artista"], ["year", "Ano"], ["count", "Quantidade de músicas"], ["length", "Duração"]],
  artists: [["date", "Data de adição"], ["name", "Nome"], ["count", "Quantidade de músicas"], ["plays", "Tempo de reprodução"]],
  podcasts: [["date", "Data de adição"], ["name", "Nome"]],
};
const FILTERS: Record<string, [string, string][]> = {
  songs: [["library", "Biblioteca"], ["liked", "Curtidas"], ["downloaded", "Baixadas"], ["local", "Arquivos locais"], ["uploaded", "Enviadas"]],
  albums: [["library", "Biblioteca"], ["downloaded", "Baixados"], ["uploaded", "Enviados"]],
  artists: [["library", "Seguindo"], ["liked", "Com músicas curtidas"]],
  podcasts: [["shows", "Programas"], ["new", "Episódios novos"], ["later", "Para depois"], ["downloaded", "Baixados"]],
};

function ListRow({ item }: { item: Item }) {
  const r = resolveItem(item); const openMenu = useUI((s) => s.openMenu);
  if (!r) return null;
  return (
    <div role="button" tabIndex={0} onClick={() => r.to && nav(r.to)} onContextMenu={(e) => openMenu(e, r.menu())} className="group flex items-center gap-4 h-16 px-3 rounded-xl hover:bg-s2 transition-colors">
      <Cover hue={r.hue} seed={r.seed} artist={(r as any).artist} icon={(r as any).icon} className="size-12 rounded-lg" />
      <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.title}</div><div className="truncate text-t3 text-[0.84rem]">{r.sub}</div></div>
      {r.ids.length > 0 && <span className="text-t3 text-[0.84rem] tnum">{r.ids.length} músicas</span>}
      {item.type !== "artist" && <IconBtn label="Tocar" className="opacity-0 group-hover:opacity-100 !bg-accent !text-accent-fg" onClick={(e) => { e.stopPropagation(); usePlayer.getState().play(r.ids, 0, r.title); }}><Play fill="currentColor" /></IconBtn>}
    </div>
  );
}

export default function Library({ tab = "playlists" }: { tab?: string }) {
  const lib = useLib();
  const openMenuAt = useUI((s) => s.openMenuAt);
  const [filter, setFilter] = useState<Record<string, string>>({ songs: "library", albums: "library", artists: "library", podcasts: "shows" });
  const [sort, setSort] = useState<Record<string, string>>({});
  const [desc, setDesc] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState<number | null>(null);
  const showAuto: Record<string, boolean> = { liked: useSetting("showLiked"), downloaded: useSetting("showDownloaded"), top: useSetting("showTop"), cached: useSetting("showCached"), local: useSetting("showLocal"), uploaded: useSetting("showUploaded"), weekly: useSetting("showMostStats"), monthly: useSetting("showMostStats"), later: true };
  const f = filter[tab], s = sort[tab] ?? "date";
  const match = (text: string) => !q || norm(text).includes(norm(q));
  const dir = (n: number) => (desc ? -n : n);
  const downloaded = Object.keys(lib.downloads).filter((k) => lib.downloads[k] >= 1);

  const songIds = useMemo(() => {
    const base = f === "liked" ? lib.liked : f === "downloaded" ? downloaded : f === "local" ? lib.localFiles : f === "uploaded" ? [] : [...new Set([...lib.liked, ...downloaded, ...lib.localFiles, ...lib.savedAlbums.flatMap((a) => getAlbum(a)?.trackIds ?? [])])];
    let t = getTracks(base).filter((x) => !x.episode && match(`${x.title} ${artistOf(x)}`));
    if (s === "name") t.sort((a, b) => dir(a.title.localeCompare(b.title, "pt-BR")));
    else if (s === "artist") t.sort((a, b) => dir(artistOf(a).localeCompare(artistOf(b), "pt-BR")));
    else if (s === "plays") t.sort((a, b) => dir((lib.counts[b.id] ?? 0) - (lib.counts[a.id] ?? 0)));
    else if (desc) t = t.reverse();
    return t.map((x) => x.id);
  }, [f, s, desc, q, lib.liked, lib.downloads, lib.localFiles, lib.savedAlbums]);

  const playlistItems = (): Item[] => {
    const autos = Object.keys(AUTO).filter((k) => showAuto[k] && k !== "later");
    let own = [...lib.playlists.map((p) => p.id), ...lib.savedPlaylists].map((id) => resolvePlaylist(id, lib)!).filter((p) => p && match(p.title));
    if (s === "name") own.sort((a, b) => dir(a.title.localeCompare(b.title, "pt-BR")));
    else if (s === "count") own.sort((a, b) => dir(b.trackIds.length - a.trackIds.length));
    else if (s === "updated") own.sort((a, b) => dir((b.updated ?? 0) - (a.updated ?? 0)));
    else if (desc) own = own.reverse();
    return [...(q ? [] : autos.map((id) => ({ type: "playlist" as const, id }))), ...own.map((p) => ({ type: "playlist" as const, id: p.id }))];
  };
  const albumItems = (): Item[] => {
    let a = lib.savedAlbums.map((id) => getAlbum(id)!).filter((x) => x && match(x.title) && (f !== "downloaded" || x.trackIds.every((t) => lib.downloads[t] >= 1)) && f !== "uploaded");
    const len = (x: typeof a[0]) => getTracks(x.trackIds).reduce((n, t) => n + t.duration, 0);
    if (s === "name") a.sort((x, y) => dir(x.title.localeCompare(y.title, "pt-BR")));
    else if (s === "artist") a.sort((x, y) => dir(getArtist(x.artistId)!.name.localeCompare(getArtist(y.artistId)!.name, "pt-BR")));
    else if (s === "year") a.sort((x, y) => dir(y.year - x.year));
    else if (s === "count") a.sort((x, y) => dir(y.trackIds.length - x.trackIds.length));
    else if (s === "length") a.sort((x, y) => dir(len(y) - len(x)));
    else if (desc) a = a.reverse();
    return a.map((x) => ({ type: "album" as const, id: x.id }));
  };
  const artistItems = (): Item[] => {
    const ids = f === "liked" ? [...new Set(getTracks(lib.liked).map((t) => t.artistId))] : lib.followed;
    const count = (id: string) => songs.filter((t) => t.artistId === id && lib.liked.includes(t.id)).length;
    let a = ids.map((id) => getArtist(id)!).filter((x) => x && match(x.name));
    if (s === "name") a.sort((x, y) => dir(x.name.localeCompare(y.name, "pt-BR")));
    else if (s === "count" || s === "plays") a.sort((x, y) => dir(count(y.id) - count(x.id)));
    else if (desc) a = a.reverse();
    return a.map((x) => ({ type: "artist" as const, id: x.id }));
  };

  const items: Item[] = tab === "playlists" ? playlistItems() : tab === "albums" ? albumItems() : tab === "artists" ? artistItems()
    : tab === "mix" ? [...playlistItems(), ...albumItems(), ...artistItems(), ...lib.subscribedPodcasts.map((id) => ({ type: "podcast" as const, id }))].sort((a, b) => s === "name" ? dir((resolveItem(a, lib)?.title ?? "").localeCompare(resolveItem(b, lib)?.title ?? "", "pt-BR")) : 0)
    : [];
  const podcastEpisodes = f === "later" ? lib.later : f === "downloaded" ? downloaded.filter((id) => getTrack(id)?.episode) : f === "new" ? lib.subscribedPodcasts.flatMap((id) => getPodcast(id)?.episodeIds.slice(0, 2) ?? []) : [];
  // O que está salvo nas contas conectadas (a biblioteca do YouTube Music, do Spotify e do SoundCloud)
  const accountSections = (isTauri && (tab === "playlists" || tab === "albums" || tab === "artists")
    ? ([["youtube", "YouTube Music"], ["spotify", "Spotify"], ["soundcloud", "SoundCloud"]] as const).filter(([p]) => !!lib.accounts[p] && (p !== "soundcloud" || tab === "playlists"))
    : []);
  const upload = () => { setUploading(0); let n = 0; const t = setInterval(() => { n++; if (n > 4) { clearInterval(t); setUploading(null); toast("Envio concluído"); } else setUploading(n); }, 600); };
  const empty: Record<string, [string, string]> = { playlists: ["Suas playlists aparecem aqui", "Crie a primeira ou importe de outro serviço."], albums: ["Os álbuns da biblioteca aparecem aqui", "Salve um álbum para encontrá-lo depois."], artists: ["Os artistas da biblioteca aparecem aqui", "Siga artistas para acompanhar os lançamentos."], songs: ["As músicas da biblioteca aparecem aqui", "Curta ou baixe músicas para vê-las nesta lista."], mix: ["Sua biblioteca está vazia", ""], podcasts: ["Nenhum programa salvo", "Salve um podcast para acompanhar os episódios."] };

  return (
    <div className="px-8 pt-5 pb-10">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[2.1rem] font-bold tracking-tight flex-1">Biblioteca</h1>
        <Btn icon={<FolderSearch />} variant="ghost" onClick={() => { toast("Varrendo pastas de música…"); setTimeout(() => toast(`${lib.localFiles.length} músicas locais encontradas`), 1500); }}>Varrer pastas</Btn>
        <Btn icon={<Import />} onClick={() => openDialog("import")}>Importar</Btn>
        <Btn variant="primary" icon={<Plus />} onClick={() => openDialog("createPlaylist")}>Nova playlist</Btn>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {TABS.map(([v, l]) => <Chip key={v} active={tab === v} onClick={() => { useUI.getState().replace(`library/${v}`); setQ(""); }}>{l}</Chip>)}
        <div className="flex-1" />
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-t3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar na biblioteca" className="w-56 h-9 pl-9 pr-3 rounded-full bg-s2 placeholder:text-t3 text-[0.88rem]" /></div>
        <button onClick={(e) => openMenuAt(e.currentTarget, SORTS[tab].map(([v, label]) => ({ label, checked: s === v, onClick: () => setSort({ ...sort, [tab]: v }) })))} className="h-9 px-3 rounded-full hover:bg-s2 inline-flex items-center gap-2 text-t2 hover:text-t1 text-[0.86rem] font-medium"><ArrowDownUp className="size-4" />{SORTS[tab].find((x) => x[0] === s)?.[1]}</button>
        <IconBtn label={desc ? "Ordem decrescente" : "Ordem crescente"} size={34} onClick={() => setDesc(!desc)}>{desc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}</IconBtn>
        {tab !== "songs" && <IconBtn label={view === "grid" ? "Ver como lista" : "Ver como grade"} size={34} onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? <List /> : <LayoutGrid />}</IconBtn>}
      </div>
      {FILTERS[tab] && <div className="flex gap-2 mb-5">{FILTERS[tab].map(([v, l]) => <Chip key={v} active={f === v} onClick={() => setFilter({ ...filter, [tab]: v })}>{l}</Chip>)}</div>}

      {accountSections.map(([p, name]) => (
        <section key={p} className="mb-10">
          <SectionTitle sub="Salvo na sua conta">{name}</SectionTitle>
          <YtLibraryView provider={p} kind={tab as "playlists" | "albums" | "artists"} filter={q} />
        </section>
      ))}
      {accountSections.length > 0 && <SectionTitle sub="Fica só nesta instalação do MetroMusic">Neste computador</SectionTitle>}
      {tab === "songs" ? (
        <div className="-mx-3">
          <div className="flex items-center gap-3 px-3 mb-3">
            <span className="text-t3 text-[0.88rem] flex-1">{songIds.length} músicas · {fmtLong(getTracks(songIds).reduce((n, t) => n + t.duration, 0))}</span>
            {f === "uploaded" && <Btn size="sm" icon={<Upload />} disabled={uploading !== null} onClick={upload}>{uploading !== null ? `Enviando ${uploading} de 4…` : "Enviar músicas"}</Btn>}
            <Btn size="sm" icon={<Shuffle />} disabled={!songIds.length} onClick={() => usePlayer.getState().play(songIds, 0, "Músicas da biblioteca", { shuffle: true })}>Embaralhar</Btn>
          </div>
          {songIds.length ? <TrackList ids={songIds} title={q ? "Músicas buscadas" : "Todas as músicas"} />
            : f === "uploaded" ? <Empty icon={<Upload />} title="Nenhuma música enviada" text="Envie arquivos MP3, M4A, WMA, FLAC ou OGG de até 300 MB para ouvir em qualquer lugar."><Btn icon={<Upload />} onClick={upload}>Enviar músicas</Btn></Empty>
            : <Empty icon={<LibraryIcon />} title={q ? "Nenhum resultado encontrado" : empty.songs[0]} text={q ? undefined : empty.songs[1]} />}
        </div>
      ) : tab === "podcasts" && f !== "shows" ? (
        podcastEpisodes.length ? <div className="-mx-3"><TrackList ids={podcastEpisodes} title="Episódios" showAlbum header={false} dateOf={(id) => getTrack(id)?.date} /></div>
          : <Empty icon={<LibraryIcon />} title={f === "downloaded" ? "Nenhum episódio baixado" : "Nenhum episódio por aqui"} />
      ) : tab === "podcasts" ? (
        lib.subscribedPodcasts.length ? (<>
          <Grid>{lib.subscribedPodcasts.filter((id) => match(getPodcast(id)?.title ?? "")).map((id) => <MediaCard key={id} item={{ type: "podcast", id }} />)}</Grid>
          <div className="mt-10"><SectionTitle>Canais</SectionTitle><div className="flex gap-3 flex-wrap">{lib.subscribedPodcasts.map((id) => { const p = getPodcast(id)!; return <button key={id} onClick={() => nav(`podcast/${id}`)} className="flex items-center gap-3 h-14 pl-2 pr-5 rounded-full bg-s1 hover:bg-s2"><Cover hue={p.hue} seed={p.seed + 1} round className="size-10" /><span className="font-medium">{p.author}</span></button>; })}</div></div>
        </>) : <Empty icon={<LibraryIcon />} title={empty.podcasts[0]} text={empty.podcasts[1]}><Btn onClick={() => nav("explore")}>Explorar podcasts</Btn></Empty>
      ) : items.length === 0 ? (
        <Empty icon={<LibraryIcon />} title={q ? "Nenhum resultado encontrado" : empty[tab][0]} text={q ? undefined : empty[tab][1]}>{tab === "playlists" && !q && <Btn variant="primary" icon={<Plus />} onClick={() => openDialog("createPlaylist")}>Nova playlist</Btn>}</Empty>
      ) : view === "grid" ? <Grid>{items.map((it) => <MediaCard key={it.type + it.id} item={it} />)}</Grid>
        : <div className={cx("-mx-3")}>{items.map((it) => <ListRow key={it.type + it.id} item={it} />)}</div>}
    </div>
  );
}
