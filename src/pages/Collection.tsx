import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowDownUp, BookmarkCheck, BookmarkPlus, Check, CloudUpload, Ellipsis, Heart, ListMusic, Pencil, Play, Plus, Radio, Search, Shuffle, X, Pause, Lock } from "lucide-react";
import { albumOf, albums, artistAlbums, artistOf, getAlbum, getArtist, getPodcast, getTrack, getTracks, sample, songs, type Track } from "../lib/catalog";
import { albumMenu, playlistMenu } from "../lib/menus";
import { cx, fmtLong, norm } from "../lib/util";
import { resolvePlaylist, topFor, useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { useSetting } from "../store/settings";
import { nav, openDialog, toast, useUI } from "../store/ui";
import { ShelfCards, TrackList, TrackTile } from "../components/media";
import { Badge, Btn, Cover, coverBg, Empty, IconBtn, SectionTitle, Segmented, Spinner } from "../components/ui";

/** Cabeçalho imersivo compartilhado por álbum, playlist, podcast e artista. */
export function Hero({ hue, seed, kind, title, meta, description, children, cover, round }: { hue: number; seed: number; kind: string; title: string; meta: React.ReactNode; description?: string; children?: React.ReactNode; cover: React.ReactNode; round?: boolean }) {
  const immersive = useSetting<boolean>("immersiveHeader");
  return (
    <div className="relative px-8 pt-8 pb-6 overflow-hidden">
      {immersive && <><div className="absolute -inset-x-20 -top-40 h-[30rem] blur-[80px] opacity-45 saturate-150 pointer-events-none" style={{ background: coverBg(hue, seed) }} /><div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/40 to-bg pointer-events-none" /></>}
      <div className="relative flex items-end gap-7">
        <div className={cx("shrink-0 w-56 max-[1000px]:w-40 shadow-2xl shadow-black/45", round ? "rounded-full" : "rounded-2xl")}>{cover}</div>
        <div className="min-w-0 flex-1 pb-1">
          <div className="text-[0.76rem] font-semibold uppercase tracking-widest text-t2">{kind}</div>
          <h1 className="font-bold tracking-tight leading-[1.05] my-2 line-clamp-2" style={{ fontSize: title.length > 26 ? "2.4rem" : title.length > 14 ? "3.2rem" : "4.2rem" }}>{title}</h1>
          {description && <p className="text-t2 max-w-2xl line-clamp-2 mb-1.5">{description}</p>}
          <div className="text-t2 text-[0.92rem] flex flex-wrap items-center gap-x-1.5">{meta}</div>
        </div>
      </div>
      {children && <div className="relative flex items-center gap-2.5 mt-6 flex-wrap">{children}</div>}
    </div>
  );
}

export function PlayActions({ ids, title, disabled }: { ids: string[]; title: string; disabled?: boolean }) {
  const playingThis = usePlayer((s) => s.playing && s.queueTitle === title && ids.includes(s.queue[s.index]));
  return (<>
    <Btn variant="primary" size="lg" disabled={disabled || !ids.length} icon={playingThis ? <Pause fill="currentColor" /> : <Play fill="currentColor" />} onClick={() => (playingThis ? usePlayer.getState().toggle() : usePlayer.getState().play(ids, 0, title))}>{playingThis ? "Pausar" : "Tocar"}</Btn>
    <Btn size="lg" disabled={disabled || !ids.length} icon={<Shuffle />} onClick={() => usePlayer.getState().play(ids, 0, title, { shuffle: true })}>Embaralhar</Btn>
  </>);
}

function DownloadBtn({ ids }: { ids: string[] }) {
  const d = useLib((s) => s.downloads);
  const done = ids.length > 0 && ids.every((i) => d[i] >= 1), busy = ids.some((i) => i in d && d[i] < 1);
  const pct = busy ? Math.round((ids.reduce((s, i) => s + (d[i] ?? 0), 0) / ids.length) * 100) : 0;
  return (
    <IconBtn label={done ? "Remover downloads" : busy ? `Baixando… ${pct}%` : "Baixar para ouvir offline"} size={44} active={done} disabled={!ids.length}
      onClick={() => done ? openDialog("confirm", { title: "Remover downloads?", text: "As músicas deixam de estar disponíveis offline.", confirm: "Remover", danger: true, action: () => useLib.getState().removeDownload(ids) }) : !busy && (useLib.getState().download(ids), toast(`Baixando ${ids.length} músicas`))}>
      {busy ? <span className="relative grid place-items-center"><Spinner className="size-6" /><span className="absolute text-[0.55rem] font-bold tnum">{pct}</span></span> : done ? <Check /> : <ArrowDownToLine />}
    </IconBtn>
  );
}

const SORTS: [string, string][] = [["custom", "Ordem personalizada"], ["title", "Título"], ["artist", "Artista"], ["album", "Álbum"], ["duration", "Duração"], ["plays", "Mais ouvidas"]];

export function PlaylistPage({ id }: { id: string }) {
  const lib = useLib();
  const [period, setPeriod] = useState("all");
  const p = useMemo(() => { const b = resolvePlaylist(id, lib); return b && id === "top" && period !== "all" ? { ...b, trackIds: topFor(Number(period)) } : b; }, [id, lib, period]);
  const openMenuAt = useUI((s) => s.openMenuAt);
  const [sort, setSort] = useState("custom"); const [desc, setDesc] = useState(false);
  const [q, setQ] = useState(""); const [searching, setSearching] = useState(false);
  const suggestions = useMemo(() => (p ? sample(songs.filter((s) => !p.trackIds.includes(s.id)), 6, p.seed + p.trackIds.length).map((t) => t.id) : []), [p?.seed, p?.trackIds.length]);
  if (!p) return <Empty icon={<ListMusic />} title="Playlist não encontrada" text="Ela pode ter sido apagada."><Btn onClick={() => nav("library/playlists")}>Ir para a biblioteca</Btn></Empty>;
  const own = lib.playlists.some((x) => x.id === id), saved = lib.savedPlaylists.includes(id);
  let tracks = getTracks(p.trackIds);
  if (q) tracks = tracks.filter((t) => norm(`${t.title} ${artistOf(t)} ${albumOf(t)}`).includes(norm(q)));
  if (sort !== "custom") {
    const key = (t: Track) => (sort === "title" ? t.title : sort === "artist" ? artistOf(t) : sort === "album" ? albumOf(t) : sort === "duration" ? t.duration : -(lib.counts[t.id] ?? 0));
    tracks = [...tracks].sort((a, b) => { const x = key(a), y = key(b); return (typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "pt-BR")) * (desc ? -1 : 1); });
  } else if (desc) tracks = [...tracks].reverse();
  const ids = tracks.map((t) => t.id);
  const total = tracks.reduce((s, t) => s + t.duration, 0);
  const kind = p.kind === "auto" ? "Playlist automática" : p.kind === "mix" ? "Mix" : p.kind === "community" ? "Playlist da comunidade" : p.kind === "editorial" ? "Playlist editorial" : "Playlist";
  return (
    <div className="pb-10">
      <Hero hue={p.hue} seed={p.seed} kind={kind} title={p.title} description={p.description} cover={
        <button className="group relative block w-full" disabled={!own} onClick={() => openDialog("editCover", { id })}>
          <Cover hue={p.hue} seed={p.seed} icon={p.icon} className="w-full rounded-2xl" />
          {own && <span className="absolute inset-0 rounded-2xl bg-black/55 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity text-white"><Pencil className="size-7" /></span>}
        </button>}
        meta={<><b className="font-semibold text-t1">{p.owner}</b><span>·</span><span>{p.trackIds.length} músicas</span>{total > 0 && <><span>·</span><span>{fmtLong(total)}</span></>}{p.synced && <Badge tone="accent" className="ml-1"><CloudUpload />Sincronizada</Badge>}{p.kind === "auto" && <Badge className="ml-1"><Lock />Gerada automaticamente</Badge>}</>}>
        <PlayActions ids={ids} title={p.title} />
        <IconBtn label="Iniciar rádio" size={44} disabled={!ids.length} onClick={() => usePlayer.getState().startRadio(ids[0])}><Radio /></IconBtn>
        <DownloadBtn ids={p.trackIds} />
        {!own && p.kind !== "auto" && <IconBtn label={saved ? "Remover da biblioteca" : "Salvar na biblioteca"} size={44} active={saved} onClick={() => { useLib.getState().toggleSavedPlaylist(id); toast(saved ? "Removida da biblioteca" : "Salva na biblioteca"); }}>{saved ? <BookmarkCheck /> : <BookmarkPlus />}</IconBtn>}
        {own && <IconBtn label="Editar detalhes" size={44} onClick={() => openDialog("editPlaylist", { id })}><Pencil /></IconBtn>}
        <IconBtn label="Mais opções" size={44} onClick={(e) => openMenuAt(e.currentTarget, playlistMenu(p))}><Ellipsis /></IconBtn>
        <div className="flex-1" />
        {searching
          ? <div className="relative w-64"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-t3" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (setQ(""), setSearching(false))} placeholder="Buscar na playlist" className="w-full h-9.5 pl-9 pr-8 rounded-full bg-s2 placeholder:text-t3" /><button aria-label="Fechar busca" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-t3" onClick={() => { setQ(""); setSearching(false); }}><X className="size-4" /></button></div>
          : <IconBtn label="Buscar na playlist" onClick={() => setSearching(true)}><Search /></IconBtn>}
        <button onClick={(e) => openMenuAt(e.currentTarget, [...SORTS.filter((s) => own || s[0] !== "custom" || true).map(([v, label]) => ({ label: v === "custom" && !own ? "Ordem original" : label, checked: sort === v, onClick: () => setSort(v) })), { divider: true }, { label: desc ? "Ordem decrescente" : "Ordem crescente", icon: <ArrowDownUp />, onClick: () => setDesc(!desc) }])}
          className="h-9 px-3 rounded-full hover:bg-s2 inline-flex items-center gap-2 text-t2 hover:text-t1 text-[0.86rem] font-medium"><ArrowDownUp className="size-4" />{sort === "custom" ? (own ? "Ordem personalizada" : "Ordem original") : SORTS.find((s) => s[0] === sort)![1]}</button>
      </Hero>
      {id === "top" && <div className="px-8 pb-4"><Segmented id="top-period" value={period} onChange={setPeriod} options={[["1", "24 horas"], ["7", "Semana"], ["30", "Mês"], ["365", "Ano"], ["all", "Tudo"]]} /></div>}
      <div className="px-5">
        {p.trackIds.length === 0 ? (
          <Empty icon={<ListMusic />} title={p.kind === "auto" ? "Nada por aqui ainda" : "A playlist está vazia"} text={p.kind === "auto" ? "Esta lista se preenche sozinha conforme você usa o app." : "Arraste músicas para cá, use o menu de qualquer faixa ou comece pelas sugestões abaixo."} />
        ) : tracks.length === 0 ? <Empty icon={<Search />} title="Nenhum resultado" text={`Nada em "${p.title}" corresponde a "${q}".`} />
          : <TrackList ids={ids} title={p.title} ctx={{ playlistId: own ? id : undefined, cache: id === "cached" }} onReorder={own && sort === "custom" && !q && !desc ? (next) => useLib.getState().updatePlaylist(id, { trackIds: next }) : undefined} />}
        {own && sort === "custom" && !q && p.trackIds.length > 1 && <div className="text-t3 text-[0.8rem] px-3 mt-3">Arraste as faixas para reordenar.</div>}
      </div>
      {own && (
        <div className="px-8 mt-10">
          <SectionTitle sub="Com base no que já está na playlist" action={<Btn size="sm" variant="ghost" icon={<Plus />} onClick={() => { useLib.getState().addToPlaylist(id, suggestions); toast("Sugestões adicionadas"); }}>Adicionar todas</Btn>}>Sugestões</SectionTitle>
          <div className="grid gap-x-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(21rem, 1fr))" }}>
            {suggestions.map((sid, i) => (
              <div key={sid} className="flex items-center gap-1"><div className="flex-1 min-w-0"><TrackTile id={sid} ids={suggestions} title="Sugestões" i={i} /></div>
                <Btn size="sm" variant="outline" icon={<Plus />} onClick={() => { useLib.getState().addToPlaylist(id, [sid]); toast(`"${getTrack(sid)?.title}" adicionada`); }}>Adicionar</Btn></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AlbumPage({ id }: { id: string }) {
  const a = getAlbum(id);
  const saved = useLib((s) => s.savedAlbums.includes(id));
  const openMenuAt = useUI((s) => s.openMenuAt);
  if (!a) return <Empty icon={<ListMusic />} title="Álbum não encontrado" />;
  const artist = getArtist(a.artistId)!;
  const tracks = getTracks(a.trackIds);
  const total = tracks.reduce((s, t) => s + t.duration, 0);
  const more = artistAlbums(a.artistId).filter((x) => x.id !== id);
  const versions = sample(albums.filter((x) => x.artistId !== a.artistId), 3, a.seed).map((x, i) => ({ ...x, label: ["Edição deluxe", "Ao vivo", "Remasterizado"][i] }));
  const hires = tracks.find((t) => t.tier);
  return (
    <div className="pb-10">
      <Hero hue={a.hue} seed={a.seed} kind={a.kind} title={a.title} cover={<Cover hue={a.hue} seed={a.seed} className="w-full rounded-2xl" />}
        meta={<><button className="inline-flex items-center gap-2 font-semibold text-t1 hover:underline" onClick={() => nav(`artist/${artist.id}`)}><Cover hue={artist.hue} seed={artist.seed} artist className="size-6" />{artist.name}</button><span>·</span><span>{a.year}</span><span>·</span><span>{tracks.length} {tracks.length === 1 ? "música" : "músicas"}</span><span>·</span><span>{fmtLong(total)}</span>{hires?.tier && <Badge tone="accent" className="ml-1">{hires.tier}</Badge>}</>}>
        <PlayActions ids={a.trackIds} title={a.title} />
        <IconBtn label="Iniciar rádio" size={44} onClick={() => usePlayer.getState().startRadio(a.trackIds[0])}><Radio /></IconBtn>
        <IconBtn label={saved ? "Remover da biblioteca" : "Adicionar à biblioteca"} size={44} active={saved} onClick={() => { useLib.getState().toggleAlbum(id); toast(saved ? "Removido da biblioteca" : "Adicionado à biblioteca"); }}>{saved ? <BookmarkCheck /> : <BookmarkPlus />}</IconBtn>
        <DownloadBtn ids={a.trackIds} />
        <IconBtn label="Curtir todas" size={44} onClick={() => { useLib.getState().setLiked(a.trackIds, true); toast("Todas as faixas curtidas"); }}><Heart /></IconBtn>
        <IconBtn label="Mais opções" size={44} onClick={(e) => openMenuAt(e.currentTarget, albumMenu(a))}><Ellipsis /></IconBtn>
      </Hero>
      <div className="px-5"><TrackList ids={a.trackIds} title={a.title} showAlbum={false} showCover={false} showPlays numbered /></div>
      <div className="px-8 mt-5 text-t3 text-[0.82rem] leading-relaxed">Lançado em {a.year}<br />℗ {a.year} {artist.name} · Distribuição independente</div>
      <div className="px-8 mt-10">
        {more.length > 0 && <ShelfCards title={`Mais de ${artist.name}`} items={more.map((x) => ({ type: "album" as const, id: x.id }))} onMore={() => nav(`artist/${artist.id}`)} />}
        <ShelfCards title="Outras versões" items={versions.map((x) => ({ type: "album" as const, id: x.id }))} />
      </div>
    </div>
  );
}

export function PodcastPage({ id }: { id: string }) {
  const p = getPodcast(id);
  const sub = useLib((s) => s.subscribedPodcasts.includes(id));
  if (!p) return <Empty icon={<ListMusic />} title="Podcast não encontrado" />;
  return (
    <div className="pb-10">
      <Hero hue={p.hue} seed={p.seed} kind="Podcast" title={p.title} description={p.description} cover={<Cover hue={p.hue} seed={p.seed} className="w-full rounded-2xl" />} meta={<><b className="font-semibold text-t1">{p.author}</b><span>·</span><span>{p.episodeIds.length} episódios</span></>}>
        <Btn variant="primary" size="lg" icon={<Play fill="currentColor" />} onClick={() => usePlayer.getState().play(p.episodeIds, 0, p.title)}>Episódio mais recente</Btn>
        <Btn size="lg" variant={sub ? "outline" : "soft"} icon={sub ? <Check /> : <Plus />} onClick={() => { useLib.getState().togglePodcast(id); toast(sub ? "Podcast removido da biblioteca" : "Podcast salvo na biblioteca"); }}>{sub ? "Na biblioteca" : "Salvar na biblioteca"}</Btn>
        <DownloadBtn ids={p.episodeIds.slice(0, 3)} />
      </Hero>
      <div className="px-5"><TrackList ids={p.episodeIds} title={p.title} showAlbum={false} header={false} dateOf={(eid) => getTrack(eid)?.date} /></div>
    </div>
  );
}
