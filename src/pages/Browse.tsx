import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { BadgeCheck, Check, Ellipsis, Library as LibraryIcon, Globe, Play, Plus, Radio, Search as SearchIcon, Shuffle, TrendingDown, TrendingUp, Minus, Video } from "lucide-react";
import { albums, artistAlbums, artistOf, artists, artistTracks, getArtist, getTrack, moods, playlists, podcasts, sample, songs, SOURCES, sourceName, tracks as allTracks, registerTrack, type SourceId } from "../lib/catalog";
import { artistMenu, trackMenu } from "../lib/menus";
import { cx, fmtCount, norm } from "../lib/util";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { useSetting } from "../store/settings";
import { nav, toast, useUI } from "../store/ui";
import { Grid, MediaCard, ShelfCards, TrackList, TrackTile, type Item } from "../components/media";
import { Btn, Chip, Cover, coverBg, Empty, IconBtn, SectionTitle, Segmented } from "../components/ui";
import { SourceIcon } from "../lib/brands";
import { backend, engine as api, SEARCHABLE } from "../lib/engine";
import { Hero } from "./Collection";

const A = (list: { id: string }[], type: Item["type"]): Item[] => list.map((x) => ({ type, id: x.id }));

// ───────── Artista
export function ArtistPage({ id, view }: { id: string; view?: string }) {
  const a = getArtist(id);
  const followed = useLib((s) => s.followed.includes(id));
  const openMenuAt = useUI((s) => s.openMenuAt);
  const showDesc = useSetting<boolean>("artistDescription"), showSubs = useSetting<boolean>("artistSubscribers"), showListeners = useSetting<boolean>("artistListeners");
  const [bioOpen, setBioOpen] = useState(false);
  const [topN, setTopN] = useState(5);
  if (!a) return <Empty icon={<LibraryIcon />} title="Artista não encontrado" />;
  const top = artistTracks(id), discs = artistAlbums(id);
  const ids = top.map((t) => t.id);
  const similar = sample(artists.filter((x) => x.id !== id), 8, a.seed);

  if (view === "songs") return (
    <div className="px-5 pt-6 pb-10"><div className="px-3 mb-4"><button className="text-t3 hover:text-t1 hover:underline" onClick={() => nav(`artist/${id}`)}>{a.name}</button><h1 className="text-[2rem] font-bold tracking-tight">Todas as músicas</h1></div>
      <TrackList ids={ids} title={a.name} showPlays /></div>
  );
  if (view === "albums") return (
    <div className="px-8 pt-6 pb-10"><button className="text-t3 hover:text-t1 hover:underline" onClick={() => nav(`artist/${id}`)}>{a.name}</button><h1 className="text-[2rem] font-bold tracking-tight mb-6">Discografia</h1>
      <Grid>{discs.map((d) => <MediaCard key={d.id} item={{ type: "album", id: d.id }} sub={`${d.kind} · ${d.year}`} />)}</Grid></div>
  );
  return (
    <div className="pb-10">
      <Hero hue={a.hue} seed={a.seed} round kind="Artista" title={a.name} cover={<Cover hue={a.hue} seed={a.seed} artist className="w-full" />}
        meta={<><span className="inline-flex items-center gap-1 text-accent font-medium"><BadgeCheck className="size-4" />Artista verificado</span>{showListeners && <><span>·</span><span>{fmtCount(a.listeners)} ouvintes mensais</span></>}{showSubs && <><span>·</span><span>{fmtCount(a.subscribers)} inscritos</span></>}<span>·</span><span>{a.genre}</span></>}>
        <Btn variant="primary" size="lg" icon={<Play fill="currentColor" />} onClick={() => usePlayer.getState().play(ids, 0, a.name)}>Tocar</Btn>
        <Btn size="lg" icon={<Shuffle />} onClick={() => usePlayer.getState().play(ids, 0, a.name, { shuffle: true })}>Embaralhar</Btn>
        <Btn size="lg" icon={<Radio />} onClick={() => usePlayer.getState().startRadio(ids[0])}>Rádio</Btn>
        <Btn size="lg" variant={followed ? "outline" : "soft"} icon={followed ? <Check /> : <Plus />} onClick={() => { useLib.getState().toggleFollow(id); toast(followed ? `Você deixou de seguir ${a.name}` : `Seguindo ${a.name}`); }}>{followed ? "Seguindo" : "Seguir"}</Btn>
        <IconBtn label="Mais opções" size={44} onClick={(e) => openMenuAt(e.currentTarget, artistMenu(a))}><Ellipsis /></IconBtn>
      </Hero>
      <div className="px-5 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] max-[1150px]:grid-cols-1 gap-8">
        <div>
          <div className="px-3"><SectionTitle action={<button className="text-t3 hover:text-t1 text-[0.84rem] font-medium" onClick={() => nav(`artist/${id}/songs`)}>Ver todas</button>}>Populares</SectionTitle></div>
          <TrackList ids={ids.slice(0, topN)} title={a.name} header={false} showAlbum={false} showPlays numbered />
          {ids.length > 5 && <button className="text-t3 hover:text-t1 text-[0.86rem] font-medium px-3 mt-2" onClick={() => setTopN(topN === 5 ? 10 : 5)}>{topN === 5 ? "Mostrar mais" : "Mostrar menos"}</button>}
        </div>
        {showDesc && (
          <div className="px-3">
            <SectionTitle>Sobre</SectionTitle>
            <div className="relative rounded-2xl overflow-hidden p-5 min-h-52 flex flex-col justify-end">
              <div className="absolute inset-0 opacity-70" style={{ background: coverBg(a.hue, a.seed + 3) }} /><div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/20" />
              <p className={cx("relative text-white/90 text-[0.92rem] leading-relaxed", !bioOpen && "line-clamp-2")}>{a.bio}</p>
              <button className="relative self-start mt-2 text-white font-semibold text-[0.86rem] hover:underline" onClick={() => setBioOpen(!bioOpen)}>{bioOpen ? "Mostrar menos" : "Mostrar mais"}</button>
            </div>
          </div>
        )}
      </div>
      <div className="px-8 mt-10">
        <ShelfCards title="Álbuns" items={A(discs.filter((d) => d.kind === "Álbum"), "album")} onMore={() => nav(`artist/${id}/albums`)} />
        {discs.some((d) => d.kind !== "Álbum") && <ShelfCards title="Singles e EPs" items={A(discs.filter((d) => d.kind !== "Álbum"), "album")} />}
        <ShelfCards title="Aparece em" items={A(sample(playlists.filter((p) => p.kind === "editorial" || p.kind === "mix"), 6, a.seed + 1), "playlist")} />
        <ShelfCards title="Fãs também ouvem" items={A(similar, "artist")} />
      </div>
    </div>
  );
}

// ───────── Explorar
function MoodTile({ id }: { id: string }) {
  const m = moods.find((x) => x.id === id)!;
  return (
    <motion.button whileHover={{ y: -2, scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={() => nav(`browse/${m.id}`)} className="relative h-20 rounded-xl overflow-hidden text-left px-4 flex items-center font-semibold text-white text-[1.02rem]"
      style={{ background: `linear-gradient(120deg, oklch(0.52 0.15 ${m.hue}), oklch(0.36 0.12 ${(m.hue + 40) % 360}))` }}>
      <span className="absolute -right-3 -bottom-5 size-20 rounded-xl rotate-[24deg] opacity-80 shadow-lg" style={{ background: coverBg(m.hue, m.hue * 7) }} />
      <span className="relative">{m.title}</span>
    </motion.button>
  );
}

function Charts() {
  const [scope, setScope] = useState("BR");
  const openMenu = useUI((s) => s.openMenu);
  const top = useMemo(() => sample(songs, 30, scope === "BR" ? 31 : 32).sort((a, b) => b.plays - a.plays), [scope]);
  const ids = top.map((t) => t.id);
  return (
    <div>
      <div className="flex items-center gap-3 mb-5"><Segmented id="charts" value={scope} onChange={setScope} options={[["BR", "Brasil"], ["GL", <><Globe />Global</>]]} /><div className="flex-1" /><Btn icon={<Play />} onClick={() => usePlayer.getState().play(ids, 0, `Top 30 ${scope === "BR" ? "Brasil" : "Global"}`)}>Tocar o Top 30</Btn></div>
      <div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-x-6">
        {top.map((t, i) => {
          const d = (t.seed + i) % 5; // variação fictícia de posição
          return (
            <div key={t.id} className="group flex items-center gap-3 h-15 px-2 rounded-xl hover:bg-s2 transition-colors" onDoubleClick={() => usePlayer.getState().play(ids, i, "Paradas")} onContextMenu={(e) => openMenu(e, trackMenu(t))}>
              <span className="w-8 text-center text-[1.2rem] font-bold tnum text-t2">{i + 1}</span>
              <span className={cx("w-4", d < 2 ? "text-ok" : d === 2 ? "text-t3" : "text-danger")}>{d < 2 ? <TrendingUp className="size-4" /> : d === 2 ? <Minus className="size-4" /> : <TrendingDown className="size-4" />}</span>
              <button onClick={() => usePlayer.getState().play(ids, i, "Paradas")} className="relative shrink-0"><Cover hue={t.hue} seed={t.seed} src={t.art} className="size-11 rounded-md" /><span className="absolute inset-0 rounded-md bg-black/50 grid place-items-center opacity-0 group-hover:opacity-100"><Play className="size-4 text-white" fill="currentColor" /></span></button>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{t.title}</div><div className="truncate text-t3 text-[0.84rem]">{artistOf(t)}</div></div>
              <span className="text-t3 text-[0.82rem] tnum">{fmtCount(t.plays)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ExplorePage({ tab = "all" }: { tab?: string }) {
  const set = (t: string) => useUI.getState().replace(t === "all" ? "explore" : `explore/${t}`);
  const releases = albums.filter((a) => a.year >= 2025);
  const videos = allTracks.filter((t) => t.video);
  return (
    <div className="px-8 pt-5 pb-10">
      <h1 className="text-[2.1rem] font-bold tracking-tight mb-4">Explorar</h1>
      <div className="flex gap-2 mb-7">{[["all", "Tudo"], ["releases", "Lançamentos"], ["charts", "Paradas"], ["moods", "Climas e gêneros"], ["videos", "Videoclipes"]].map(([v, l]) => <Chip key={v} active={tab === v} onClick={() => set(v)}>{l}</Chip>)}</div>
      {tab === "all" && (<>
        <ShelfCards title="Novos álbuns e singles" items={A(sample(releases, 10, 4), "album")} onMore={() => set("releases")} />
        <section className="mb-9"><SectionTitle action={<button className="text-t3 hover:text-t1 text-[0.84rem] font-medium" onClick={() => set("charts")}>Ver paradas</button>}>Em alta</SectionTitle>
          <div className="grid gap-x-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(19rem, 1fr))" }}>{sample(songs, 9, 31).sort((a, b) => b.plays - a.plays).map((t, i, arr) => <TrackTile key={t.id} id={t.id} ids={arr.map((x) => x.id)} title="Em alta" i={i} />)}</div></section>
        <section className="mb-9"><SectionTitle action={<button className="text-t3 hover:text-t1 text-[0.84rem] font-medium" onClick={() => set("moods")}>Ver todos</button>}>Climas e gêneros</SectionTitle>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(12.5rem, 1fr))" }}>{moods.slice(0, 12).map((m) => <MoodTile key={m.id} id={m.id} />)}</div></section>
        <ShelfCards title="Playlists em destaque" items={A(playlists.filter((p) => p.kind === "editorial"), "playlist")} />
        <ShelfCards title="Podcasts populares" items={A(podcasts, "podcast")} />
      </>)}
      {tab === "releases" && <Grid>{releases.map((a) => <MediaCard key={a.id} item={{ type: "album", id: a.id }} sub={`${a.kind} · ${getArtist(a.artistId)?.name}`} />)}</Grid>}
      {tab === "charts" && <Charts />}
      {tab === "moods" && [...new Set(moods.map((m) => m.group))].map((g) => (
        <section key={g} className="mb-8"><SectionTitle>{g}</SectionTitle><div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(12.5rem, 1fr))" }}>{moods.filter((m) => m.group === g).map((m) => <MoodTile key={m.id} id={m.id} />)}</div></section>
      ))}
      {tab === "videos" && (videos.length ? <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(17rem, 1fr))" }}>
        {videos.map((t, i) => (
          <button key={t.id} className="group text-left" onClick={() => usePlayer.getState().play(videos.map((v) => v.id), i, "Videoclipes")}>
            <div className="relative aspect-video rounded-xl overflow-hidden" style={{ background: coverBg(t.hue, t.seed) }}><span className="absolute inset-0 bg-black/30 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"><Play className="size-9 text-white" fill="currentColor" /></span><span className="absolute left-2 bottom-2 h-5 px-1.5 rounded bg-black/60 text-white text-[0.7rem] font-semibold inline-flex items-center gap-1"><Video className="size-3" />Vídeo</span></div>
            <div className="mt-2 font-medium truncate">{t.title}</div><div className="text-t3 text-[0.84rem] truncate">{artistOf(t)} · {fmtCount(t.plays)} visualizações</div>
          </button>
        ))}</div> : <Empty icon={<Video />} title="Nenhum videoclipe" />)}
    </div>
  );
}

export function BrowsePage({ id }: { id: string }) {
  const m = moods.find((x) => x.id === id);
  if (!m) return <Empty icon={<LibraryIcon />} title="Categoria não encontrada" />;
  return (
    <div className="pb-10">
      <div className="relative px-8 pt-12 pb-8 overflow-hidden"><div className="absolute inset-0" style={{ background: `linear-gradient(180deg, oklch(0.45 0.14 ${m.hue} / 0.7), transparent)` }} />
        <div className="relative text-[0.76rem] font-semibold uppercase tracking-widest text-t2">{m.group}</div><h1 className="relative text-[3.6rem] font-bold tracking-tight leading-none mt-1">{m.title}</h1></div>
      <div className="px-8">
        <ShelfCards title="Playlists em destaque" items={A(sample(playlists.filter((p) => p.kind === "editorial" || p.kind === "mix"), 8, m.hue), "playlist")} />
        <ShelfCards title="Feitas pela comunidade" items={A(playlists.filter((p) => p.kind === "community"), "playlist")} />
        <ShelfCards title="Álbuns essenciais" items={A(sample(albums, 10, m.hue + 2), "album")} />
        <ShelfCards title="Artistas" items={A(sample(artists, 8, m.hue + 3), "artist")} />
      </div>
    </div>
  );
}

// ───────── Busca
const FILTERS: [string, string][] = [["all", "Tudo"], ["songs", "Músicas"], ["videos", "Vídeos"], ["albums", "Álbuns"], ["artists", "Artistas"], ["playlists", "Playlists"], ["community", "Playlists da comunidade"], ["podcasts", "Podcasts"], ["episodes", "Episódios"]];

interface Remote { ids: string[]; loading: boolean; error?: string }

/** Resultados reais do provedor escolhido (só no app, onde há backend). */
function RemoteResults({ state, q, engine, retry }: { state: Remote; q: string; engine: SourceId; retry: () => void }) {
  if (state.loading) return (
    <div className="-mx-3">{Array.from({ length: 9 }, (_, i) => (
      <div key={i} className="h-14 px-3 flex items-center gap-3"><div className="skeleton size-10 rounded-md" /><div className="flex-1"><div className="skeleton h-4 w-56 mb-2" /><div className="skeleton h-3 w-32" /></div></div>
    ))}</div>
  );
  if (state.error) return <Empty icon={<SearchIcon />} title="Não foi possível buscar" text={state.error}><Btn onClick={retry}>Tentar de novo</Btn></Empty>;
  if (!state.ids.length) return <Empty icon={<SearchIcon />} title="Nenhum resultado encontrado" text={`Nada em ${sourceName(engine)} para "${q}".`} />;
  return <section className="-mx-3"><TrackList ids={state.ids} title={`Busca: ${q}`} showAlbum={state.ids.some((id) => !!getTrack(id)?.albumId)} /></section>;
}

export function SearchPage({ q }: { q: string }) {
  const [filter, setFilter] = useState("all");
  const [scope, setScope] = useState<"online" | "library">("online");
  const source = useUI((s) => s.homeSource), online = useUI((s) => s.online), openMenuAt = useUI((s) => s.openMenuAt);
  const [engine, setEngine] = useState<SourceId>(source === "offline" ? "youtube" : source);
  const lib = useLib();
  const n = norm(q);
  // Com backend e no escopo "online", a busca é de verdade (a de demonstração só vale fora do app).
  const remoteMode = backend && online && scope === "online";
  const [remote, setRemote] = useState<Remote>({ ids: [], loading: false });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!remoteMode) return;
    if (!SEARCHABLE.includes(engine)) { setRemote({ ids: [], loading: false, error: `A busca online em ${sourceName(engine)} ainda não está disponível. Use YouTube Music, SoundCloud ou Deezer.` }); return; }
    let dead = false;
    setRemote({ ids: [], loading: true });
    api.search(engine, q)
      .then((list) => { if (!dead) setRemote({ ids: (list ?? []).map((i) => registerTrack(i).id), loading: false }); })
      .catch((e) => { if (!dead) setRemote({ ids: [], loading: false, error: String(e) }); });
    return () => { dead = true; };
  }, [remoteMode, q, engine, nonce]);
  const res = useMemo(() => {
    const hit = (s: string) => norm(s).includes(n);
    const inLib = scope === "library" || !online;
    const t = songs.filter((x) => (hit(x.title) || hit(artistOf(x))) && (!inLib || lib.liked.includes(x.id) || x.id in lib.downloads || lib.localFiles.includes(x.id)));
    return {
      songs: t.filter((x) => !x.video), videos: t.filter((x) => x.video),
      albums: albums.filter((a) => (hit(a.title) || hit(getArtist(a.artistId)!.name)) && (!inLib || lib.savedAlbums.includes(a.id))),
      artists: artists.filter((a) => (hit(a.name) || hit(a.genre)) && (!inLib || lib.followed.includes(a.id))),
      playlists: [...lib.playlists, ...(inLib ? [] : playlists.filter((p) => p.kind === "editorial" || p.kind === "mix"))].filter((p) => hit(p.title)),
      community: inLib ? [] : playlists.filter((p) => p.kind === "community" && hit(p.title)),
      podcasts: podcasts.filter((p) => (hit(p.title) || hit(p.author)) && (!inLib || lib.subscribedPodcasts.includes(p.id))),
      episodes: inLib ? [] : allTracks.filter((x) => x.episode && hit(x.title)),
    };
  }, [n, scope, online, lib]);
  const count = Object.values(res).reduce((s, l) => s + l.length, 0);
  const best = res.artists[0] ?? null;
  const show = (k: string) => (filter === "all" || filter === k) && (res as any)[k].length > 0;
  const limit = (k: string, max: number) => (filter === k ? 200 : max);
  return (
    <div className="px-8 pt-5 pb-10">
      <div className="flex items-end gap-4 mb-4">
        <div className="flex-1 min-w-0"><div className="text-t3 font-medium">{remoteMode ? (remote.loading ? "Buscando…" : `${remote.ids.length} resultados`) : `${count} resultados`} {scope === "library" || !online ? "na sua biblioteca" : `em ${sourceName(engine)}`}</div><h1 className="text-[2.1rem] font-bold tracking-tight truncate">"{q}"</h1></div>
        {scope === "online" && online && <Btn variant="outline" onClick={(e) => openMenuAt(e.currentTarget, SOURCES.filter((s) => s.home && s.id !== "offline").map((s) => ({ label: `Buscar em ${s.name}`, icon: <SourceIcon id={s.id} size={16} />, checked: s.id === engine, onClick: () => setEngine(s.id) })))} icon={<SourceIcon id={engine} size={16} />}>{sourceName(engine)}</Btn>}
        <Segmented id="scope" value={!online ? "library" : scope} onChange={setScope} options={[["online", <><Globe />Online</>], ["library", <><LibraryIcon />Biblioteca</>]]} />
      </div>
      {!remoteMode && <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-8 px-8 mb-7">{FILTERS.map(([v, l]) => <Chip key={v} active={filter === v} onClick={() => setFilter(v)}>{l}{v !== "all" && (res as any)[v].length > 0 && <span className="opacity-60 tnum">{(res as any)[v].length}</span>}</Chip>)}</div>}
      {remoteMode ? <RemoteResults state={remote} q={q} engine={engine} retry={() => setNonce((x) => x + 1)} /> : count === 0 ? (
        <Empty icon={<SearchIcon />} title="Nenhum resultado encontrado" text={`Não achamos nada para "${q}". Confira a grafia ou tente outra fonte.`}>{scope === "library" && online && <Btn onClick={() => setScope("online")}>Buscar online</Btn>}</Empty>
      ) : (<>
        {filter === "all" && best && (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] max-[1000px]:grid-cols-1 gap-6 mb-9">
            <div><SectionTitle>Melhor resultado</SectionTitle>
              <button onClick={() => nav(`artist/${best.id}`)} className="group relative w-full h-56 rounded-2xl bg-s1 hover:bg-s2 transition-colors p-5 text-left flex flex-col justify-end overflow-hidden">
                <div className="absolute -top-16 -right-16 size-64 rounded-full blur-3xl opacity-40" style={{ background: coverBg(best.hue, best.seed) }} />
                <Cover hue={best.hue} seed={best.seed} artist className="size-24 mb-4 shadow-xl relative" />
                <div className="relative text-[1.7rem] font-bold tracking-tight truncate">{best.name}</div><div className="relative text-t3">Artista · {best.genre}</div>
                <span className="absolute right-5 bottom-5 size-12 rounded-full bg-accent text-accent-fg grid place-items-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all" onClick={(e) => { e.stopPropagation(); usePlayer.getState().play(artistTracks(best.id).map((t) => t.id), 0, best.name); }}><Play className="size-5 ml-0.5" fill="currentColor" /></span>
              </button></div>
            <div><SectionTitle>Músicas</SectionTitle><TrackList ids={(res.songs.length ? res.songs : artistTracks(best.id)).slice(0, 4).map((t) => t.id)} title={`Busca: ${q}`} header={false} showAlbum={false} dense /></div>
          </div>
        )}
        {show("songs") && !(filter === "all" && best) && <section className="mb-9 -mx-3"><div className="px-3"><SectionTitle action={filter === "all" && res.songs.length > 6 ? <button className="text-t3 hover:text-t1 text-[0.84rem] font-medium" onClick={() => setFilter("songs")}>Ver todas</button> : undefined}>Músicas</SectionTitle></div><TrackList ids={res.songs.slice(0, limit("songs", 6)).map((t) => t.id)} title={`Busca: ${q}`} header={filter === "songs"} /></section>}
        {filter === "all" ? (<>
          {show("artists") && <ShelfCards title="Artistas" items={A(res.artists, "artist")} />}
          {show("albums") && <ShelfCards title="Álbuns" items={A(res.albums, "album")} />}
          {show("playlists") && <ShelfCards title="Playlists" items={A(res.playlists, "playlist")} />}
          {show("community") && <ShelfCards title="Playlists da comunidade" items={A(res.community, "playlist")} />}
          {show("podcasts") && <ShelfCards title="Podcasts" items={A(res.podcasts, "podcast")} />}
        </>) : (<>
          {filter === "artists" && <Grid>{res.artists.map((x) => <MediaCard key={x.id} item={{ type: "artist", id: x.id }} />)}</Grid>}
          {filter === "albums" && <Grid>{res.albums.map((x) => <MediaCard key={x.id} item={{ type: "album", id: x.id }} />)}</Grid>}
          {(filter === "playlists" || filter === "community") && <Grid>{(res as any)[filter].map((x: any) => <MediaCard key={x.id} item={{ type: "playlist", id: x.id }} />)}</Grid>}
          {filter === "podcasts" && <Grid>{res.podcasts.map((x) => <MediaCard key={x.id} item={{ type: "podcast", id: x.id }} />)}</Grid>}
        </>)}
        {show("videos") && <section className="mb-9 -mx-3"><div className="px-3"><SectionTitle>Vídeos</SectionTitle></div><TrackList ids={res.videos.slice(0, limit("videos", 4)).map((t) => t.id)} title={`Busca: ${q}`} header={false} /></section>}
        {show("episodes") && <section className="mb-9 -mx-3"><div className="px-3"><SectionTitle>Episódios</SectionTitle></div><TrackList ids={res.episodes.slice(0, limit("episodes", 4)).map((t) => t.id)} title={`Busca: ${q}`} header={false} showAlbum={false} dateOf={(id) => getTrack(id)?.date} /></section>}
        {filter !== "all" && !(res as any)[filter].length && <Empty icon={<SearchIcon />} title="Nada nesta categoria" text="Tente outro filtro."><Btn onClick={() => setFilter("all")}>Ver tudo</Btn></Empty>}
      </>)}
    </div>
  );
}
