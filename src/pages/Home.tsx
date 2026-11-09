import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Dices, Gift, LogIn, Mic, Play, RefreshCw, Shuffle, Sparkles, WifiOff, X } from "lucide-react";
import { albums, artistOf, artists, getAlbum, getArtist, getPodcast, getTrack, moods, playlists, podcasts, sample, songs, SOURCES, type SourceId } from "../lib/catalog";
import { trackMenu } from "../lib/menus";
import { cx } from "../lib/util";
import { resolvePlaylist, useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { useSetting } from "../store/settings";
import { nav, openDialog, toast, useUI } from "../store/ui";
import { setSetting } from "../store/settings";
import { MediaCard, resolveItem, Shelf, ShelfCards, TrackTile, useCardWidth, type Item } from "../components/media";
import { Badge, Btn, Chip, Cover, coverBg, Empty, IconBtn, SectionTitle } from "../components/ui";

const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };

function Skeleton() {
  return (
    <div className="px-8 pt-4">
      <div className="skeleton h-10 w-72 mb-8" />
      <div className="grid grid-cols-3 gap-3 mb-10">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-16" />)}</div>
      <div className="skeleton h-7 w-56 mb-4" />
      <div className="flex gap-4">{Array.from({ length: 6 }, (_, i) => <div key={i} className="shrink-0 w-44"><div className="skeleton aspect-square mb-3" /><div className="skeleton h-4 w-32 mb-2" /><div className="skeleton h-3 w-20" /></div>)}</div>
    </div>
  );
}

function SpeedDial() {
  const pins = useLib((s) => s.pins);
  const openMenu = useUI((s) => s.openMenu);
  if (!pins.length) return null;
  return (
    <section className="mb-9">
      <SectionTitle>Acesso rápido</SectionTitle>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(15.5rem, 1fr))" }}>
        {pins.slice(0, 11).map((p) => {
          const r = resolveItem(p); if (!r) return null;
          return (
            <motion.button key={p.id} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => (r.to ? nav(r.to) : usePlayer.getState().play(r.ids, 0, r.title))} onContextMenu={(e) => openMenu(e, r.menu())}
              className="group h-16 rounded-xl bg-s1 hover:bg-s2 flex items-center gap-3 pr-3 overflow-hidden text-left transition-colors">
              <Cover hue={r.hue} seed={r.seed} artist={(r as any).artist} icon={(r as any).icon} className={cx("size-16", (r as any).artist ? "scale-[0.8]" : "!rounded-none")} />
              <div className="min-w-0 flex-1"><div className="truncate font-semibold">{r.title}</div><div className="truncate text-t3 text-[0.8rem]">{r.sub}</div></div>
              {p.type !== "artist" && <span role="button" aria-label="Tocar" onClick={(e) => { e.stopPropagation(); usePlayer.getState().play(r.ids, 0, r.title); }} className="size-9 rounded-full bg-accent text-accent-fg grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"><Play className="size-4 ml-0.5" fill="currentColor" /></span>}
            </motion.button>
          );
        })}
        <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => { const t = sample(songs, 30, Date.now()); usePlayer.getState().play(t.map((x) => x.id), 0, "Sorteio"); toast("Tocando uma seleção aleatória"); }}
          className="h-16 rounded-xl border border-dashed border-line hover:bg-s1 flex items-center justify-center gap-2.5 text-t2 hover:text-t1 font-medium transition-colors"><Dices className="size-5" />Sortear algo</motion.button>
      </div>
    </section>
  );
}

function TrackGrid({ title, sub, ids, action }: { title: string; sub?: string; ids: string[]; action?: React.ReactNode }) {
  if (!ids.length) return null;
  return (
    <section className="mb-9">
      <SectionTitle sub={sub} action={action ?? <Btn size="sm" variant="ghost" icon={<Play />} onClick={() => usePlayer.getState().play(ids, 0, title)}>Tocar tudo</Btn>}>{title}</SectionTitle>
      <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(19rem, 1fr))" }}>
        {ids.map((id, i) => <TrackTile key={id} id={id} ids={ids} title={title} i={i} />)}
      </div>
    </section>
  );
}

function DailyDiscover({ seed }: { seed: number }) {
  const liked = useLib((s) => s.liked);
  const openMenu = useUI((s) => s.openMenu);
  const items = useMemo(() => {
    const reasons = ["Soa como", "Porque você ouve", "Parecido com", "Com base em", "Para fãs de"];
    return sample(songs, 8, seed + 5).map((t, i) => ({ t, reason: `${reasons[i % reasons.length]} ${artistOf(getTrack(liked[i * 3] ?? songs[i].id)!)}` }));
  }, [seed, liked.length > 0]);
  return (
    <Shelf title="Sua descoberta diária" sub="Atualizada hoje">
      {items.map(({ t, reason }, i) => (
        <motion.button key={t.id} whileHover={{ y: -3 }} onClick={() => usePlayer.getState().play(items.map((x) => x.t.id), i, "Sua descoberta diária")} onContextMenu={(e) => openMenu(e, trackMenu(t))}
          className="group relative shrink-0 w-[21rem] h-44 rounded-2xl overflow-hidden text-left snap-start">
          <div className="absolute inset-0" style={{ background: coverBg(t.hue, t.seed) }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
          <div className="absolute top-3 left-3 h-6 px-2.5 rounded-full bg-black/45 backdrop-blur text-white/90 text-[0.74rem] font-medium inline-flex items-center gap-1.5"><Sparkles className="size-3" />{reason}</div>
          <div className="absolute left-4 right-16 bottom-3.5 text-white"><div className="text-[1.15rem] font-bold truncate">{t.title}</div><div className="text-white/75 truncate">{artistOf(t)}</div></div>
          <span className="absolute right-3.5 bottom-3.5 size-11 rounded-full bg-white text-black grid place-items-center shadow-xl transition-transform group-hover:scale-108"><Play className="size-5 ml-0.5" fill="currentColor" /></span>
        </motion.button>
      ))}
    </Shelf>
  );
}

function Community() {
  const items = playlists.filter((p) => p.kind === "community");
  const w = useCardWidth();
  return (
    <Shelf title="Da comunidade" sub="Playlists feitas por outras pessoas">
      {items.map((p) => (
        <div key={p.id} className="shrink-0 snap-start rounded-2xl bg-s1 p-3.5 flex gap-3.5" style={{ width: w * 2.3 }}>
          <button onClick={() => nav(`playlist/${p.id}`)} className="shrink-0"><Cover hue={p.hue} seed={p.seed} className="size-28" /></button>
          <div className="min-w-0 flex-1 flex flex-col">
            <button onClick={() => nav(`playlist/${p.id}`)} className="font-semibold truncate text-left hover:underline">{p.title}</button>
            <div className="text-t3 text-[0.8rem] mb-1.5">por {p.owner} · {p.trackIds.length} músicas</div>
            {p.trackIds.slice(0, 3).map((id) => <div key={id} className="truncate text-t2 text-[0.82rem] leading-5">{getTrack(id)?.title} <span className="text-t3">· {artistOf(getTrack(id)!)}</span></div>)}
          </div>
          <div className="flex flex-col gap-1 justify-end">
            <IconBtn label="Embaralhar" size={32} onClick={() => usePlayer.getState().play(p.trackIds, 0, p.title, { shuffle: true })}><Shuffle /></IconBtn>
            <IconBtn label="Tocar" size={32} className="!bg-accent !text-accent-fg" onClick={() => usePlayer.getState().play(p.trackIds, 0, p.title)}><Play fill="currentColor" /></IconBtn>
          </div>
        </div>
      ))}
    </Shelf>
  );
}

function DeezerNotice() {
  const seen = useSetting<boolean>("deezerNoticeSeen"), account = useLib((s) => s.accounts.deezer);
  if (seen || account) return null;
  return (
    <div className="relative mb-8 p-5 rounded-2xl bg-s1 flex items-center gap-4 overflow-hidden">
      <div className="absolute -left-10 -top-16 size-52 rounded-full blur-3xl opacity-25" style={{ background: "oklch(0.7 0.18 300)" }} />
      <div className="relative size-12 rounded-xl grid place-items-center text-white font-bold shrink-0" style={{ background: "linear-gradient(140deg, oklch(0.65 0.17 300), oklch(0.42 0.14 330))" }}>D</div>
      <div className="relative flex-1 min-w-0"><div className="flex items-center gap-2"><span className="font-semibold">Entre no Deezer</span><Badge tone="accent">Novo</Badge></div><div className="text-t3 text-[0.88rem]">Agora o MetroMusic toca direto da sua conta do Deezer: reprodução mais confiável, FLAC e letras palavra a palavra.</div></div>
      <Btn variant="primary" className="relative" onClick={() => openDialog("login", { service: "deezer" })}>Entrar no Deezer</Btn>
      <IconBtn label="Dispensar" size={32} className="relative" onClick={() => setSetting("deezerNoticeSeen", true)}><X /></IconBtn>
    </div>
  );
}

const A = (ids: { id: string }[], type: Item["type"]): Item[] => ids.map((x) => ({ type, id: x.id }));
const NEEDS_LOGIN: Partial<Record<SourceId, string>> = { spotify: "spotify", tidal: "tidal", soundcloud: "soundcloud" };

export default function Home() {
  const source = useUI((s) => s.homeSource), online = useUI((s) => s.online);
  const lib = useLib();
  const [chip, setChip] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const showWrapped = useSetting<boolean>("showWrapped"), randomize = useSetting<boolean>("randomizeHome"), quickMode = useSetting<string>("quickPicks");
  const src = SOURCES.find((s) => s.id === source)!;
  const seed = SOURCES.indexOf(src) * 1000 + nonce;
  // Simula a ida ao provedor ao trocar de fonte ou atualizar.
  useEffect(() => { setLoading(true); setChip(null); const t = setTimeout(() => setLoading(false), 520); return () => clearTimeout(t); }, [source, nonce]);

  const recentArtist = getArtist(getTrack(lib.history[0]?.id ?? "t0")!.artistId)!;
  const keep = useMemo(() => {
    const seen = new Set<string>(); const out: Item[] = [];
    for (const h of lib.history) { const t = getTrack(h.id); if (!t || t.episode) continue; const it: Item = out.length % 3 === 2 ? { type: "artist", id: t.artistId } : { type: "album", id: t.albumId }; if (!seen.has(it.id)) { seen.add(it.id); out.push(it); } if (out.length >= 12) break; }
    return out;
  }, [lib.history]);
  const forgotten = useMemo(() => Object.entries(lib.counts).sort((a, b) => b[1] - a[1]).slice(20, 29).map(([id]) => id), [lib.counts]);
  const downloaded = Object.keys(lib.downloads).filter((k) => lib.downloads[k] >= 1);
  const mood = moods.find((m) => m.id === chip);

  if (loading) return <Skeleton />;
  const loginService = NEEDS_LOGIN[source];
  const needsLogin = loginService && !lib.accounts[loginService];
  const offlineView = source === "offline" || !online;

  const header = (
    <div className="flex items-end gap-4 mb-5">
      <div className="flex-1 min-w-0">
        <div className="text-t3 font-medium flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: `oklch(0.72 0.16 ${src.hue})` }} />{offlineView ? "Offline" : src.name}</div>
        <h1 className="text-[2.1rem] font-bold tracking-tight leading-tight truncate">{greeting()}{lib.accounts.youtube ? `, ${lib.accounts.youtube}` : ""}</h1>
      </div>
      <IconBtn label="Atualizar" onClick={() => setNonce((n) => n + 1)}><RefreshCw /></IconBtn>
      <Btn variant="soft" icon={<Mic />} onClick={() => nav("recognize")}>Reconhecer</Btn>
      <Btn variant="primary" icon={<Shuffle />} onClick={() => { const ids = offlineView ? downloaded : sample(songs, 40, Date.now()).map((t) => t.id); usePlayer.getState().play(ids, 0, "Tudo embaralhado", { shuffle: true }); }}>Embaralhar tudo</Btn>
    </div>
  );

  if (offlineView) return (
    <div className="px-8 pt-3 pb-10">
      {header}
      {!online && <div className="mb-7 p-4 rounded-2xl bg-warn/10 text-warn flex items-center gap-3"><WifiOff className="size-5 shrink-0" /><span className="flex-1">Sem conexão. Mostrando só o que está neste computador.</span><Btn size="sm" variant="outline" onClick={() => useUI.getState().setOnline(true)}>Tentar reconectar</Btn></div>}
      {downloaded.length === 0 && lib.localFiles.length === 0
        ? <Empty icon={<WifiOff />} title="Nada disponível offline" text="Baixe músicas ou adicione uma pasta em Configurações › Biblioteca local."><Btn onClick={() => nav("settings/local")}>Adicionar pasta</Btn></Empty>
        : <>
          <ShelfCards title="Disponíveis offline" items={[{ type: "playlist", id: "downloaded" }, { type: "playlist", id: "local" }, { type: "playlist", id: "cached" }, ...lib.playlists.slice(0, 5).map((p) => ({ type: "playlist" as const, id: p.id }))]} />
          <TrackGrid title="Baixadas recentemente" ids={downloaded.slice(0, 12)} />
          <TrackGrid title="Arquivos locais" sub="Das suas pastas de música" ids={lib.localFiles.slice(0, 12)} />
        </>}
    </div>
  );

  const lastId = lib.history[0]?.id;
  const quick = (quickMode === "last"
    ? [...songs.filter((t) => t.artistId === recentArtist.id && t.id !== lastId).slice(0, 6), ...sample(songs, 8, seed + 9)]
    : sample(songs.filter((t) => lib.counts[t.id]), 12, seed + 1)).slice(0, 12).map((t) => t.id);
  const sections: React.ReactNode[] = source === "youtube" ? [
    <SpeedDial key="sd" />,
    <TrackGrid key="qp" title="Sugestões rápidas" sub={quickMode === "last" ? `Com base em ${getTrack(lastId ?? "")?.title ?? "a última música"}` : "Com base no que você mais ouve"} ids={quick} />,
    <ShelfCards key="kl" title="Continue ouvindo" items={keep} onMore={() => nav("history")} />,
    <DailyDiscover key="dd" seed={seed} />,
    <ShelfCards key="mx" title="Mixes" sub="Feitos para você" items={A(playlists.filter((p) => p.kind === "mix").slice(0, 6), "playlist")} />,
    <TrackGrid key="ff" title="Favoritas esquecidas" sub="Faz tempo que você não ouve" ids={forgotten} />,
    <ShelfCards key="st" title={`Parecido com ${recentArtist.name}`} sub="Semelhantes a" items={[...A(sample(artists.filter((a) => a.id !== recentArtist.id), 4, seed + 2), "artist"), ...A(sample(albums, 6, seed + 3), "album")]} />,
    <Community key="cm" />,
    <ShelfCards key="yp" title="Suas playlists do YouTube" items={lib.savedPlaylists.map((id) => ({ type: "playlist" as const, id }))} onMore={() => nav("account")} />,
    <ShelfCards key="nr" title="Lançamentos" items={A(sample(albums.filter((a) => a.year >= 2025), 10, seed + 4), "album")} onMore={() => nav("explore")} />,
    <ShelfCards key="pc" title="Seus programas" sub="Podcasts" items={A(podcasts, "podcast")} onMore={() => nav("library/podcasts")} />,
    <TrackGrid key="el" title="Episódios para depois" sub="Que você salvou" ids={lib.later} action={<Btn size="sm" variant="ghost" onClick={() => nav("playlist/later")}>Ver todos</Btn>} />,
    <TrackGrid key="le" title="Últimos episódios" sub="Dos programas que você segue" ids={lib.subscribedPodcasts.flatMap((id) => getPodcast(id)?.episodeIds.slice(0, 2) ?? [])} />,
  ] : [
    ...(source === "deezer" ? [<SpeedDial key="sd" />] : []),
    <ShelfCards key="a" title={{ tidal: "Feito para você", spotify: "Feito para você", soundcloud: "Em alta no SoundCloud", deezer: "Flow e mixes", jiosaavn: "Em alta agora", qobuz: "", youtube: "", offline: "" }[source]} sub={src.name} items={A(sample(playlists.filter((p) => p.kind === "mix" || p.kind === "editorial"), 8, seed), "playlist")} />,
    <TrackGrid key="b" title={{ tidal: "Novidades em Hi-Res", spotify: "Tocadas recentemente", soundcloud: "Curtidas recentes", deezer: "Para você hoje", jiosaavn: "Top charts", qobuz: "", youtube: "", offline: "" }[source]} ids={sample(source === "tidal" ? songs.filter((t) => t.tier === "Hi-Res") : songs, 9, seed + 1).map((t) => t.id)} />,
    <ShelfCards key="c" title={{ tidal: "Álbuns em destaque", spotify: "Seus álbuns mais ouvidos", soundcloud: "Álbuns e EPs", deezer: "Lançamentos", jiosaavn: "Novos lançamentos", qobuz: "", youtube: "", offline: "" }[source]} sub={src.name} items={A(sample(albums, 10, seed + 2), "album")} />,
    <ShelfCards key="d" title="Playlists editoriais" sub={src.name} items={A(sample(playlists.filter((p) => p.kind === "editorial"), 8, seed + 3), "playlist")} />,
    <ShelfCards key="e" title={source === "soundcloud" ? "Artistas em ascensão" : "Artistas para você"} items={A(sample(artists, 9, seed + 4), "artist")} />,
    <DailyDiscover key="dd" seed={seed} />,
  ];
  const ordered = randomize ? [sections[0], ...sample(sections.slice(1), sections.length - 1, seed + new Date().getDate())] : sections;

  return (
    <div className="px-8 pt-3 pb-10">
      {header}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-8 px-8 mb-7">
        {chip ? <Chip active onClick={() => setChip(null)} onClose={() => setChip(null)}>{mood?.title}</Chip>
          : <>{source === "youtube" && <Chip onClick={() => nav("library/podcasts")}>Podcasts</Chip>}{moods.slice(0, 10).map((m) => <Chip key={m.id} onClick={() => setChip(m.id)}>{m.title}</Chip>)}<Chip onClick={() => nav("explore/moods")}>Mais gêneros…</Chip></>}
      </div>
      {needsLogin && (
        <div className="mb-8 p-5 rounded-2xl bg-s1 flex items-center gap-4">
          <div className="size-12 rounded-full grid place-items-center text-white shrink-0" style={{ background: `oklch(0.6 0.16 ${src.hue})` }}><LogIn className="size-5" /></div>
          <div className="flex-1 min-w-0"><div className="font-semibold">Entre no {src.name} para ver o seu início personalizado</div><div className="text-t3 text-[0.88rem]">Sem login, mostramos as recomendações gerais do serviço.</div></div>
          <Btn variant="primary" onClick={() => nav(`settings/${loginService}`)}>Conectar conta</Btn>
        </div>
      )}
      {chip && mood ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <ShelfCards title={`Playlists para ${mood.title.toLowerCase()}`} items={A(sample(playlists.filter((p) => p.kind !== "local"), 9, mood.hue), "playlist")} onMore={() => nav(`browse/${mood.id}`)} />
          <TrackGrid title="Músicas em destaque" ids={sample(songs, 12, mood.hue + 1).map((t) => t.id)} />
          <ShelfCards title="Álbuns" items={A(sample(albums, 10, mood.hue + 2), "album")} />
        </motion.div>
      ) : (<>
        <DeezerNotice />
        {showWrapped && source === "youtube" && (
          <motion.button whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.995 }} onClick={() => nav("wrapped")} className="relative w-full h-28 mb-9 rounded-2xl overflow-hidden text-left flex items-center gap-5 px-7">
            <div className="absolute inset-0" style={{ background: "linear-gradient(110deg, oklch(0.55 0.2 330), oklch(0.5 0.2 280) 45%, oklch(0.6 0.17 200))" }} />
            <div className="absolute -right-10 -top-16 size-72 rounded-full bg-white/15 blur-2xl drift" />
            <Gift className="relative size-10 text-white" />
            <div className="relative flex-1 text-white"><div className="text-[1.35rem] font-bold tracking-tight">Sua Retrospectiva 2026 está pronta</div><div className="text-white/80">Veja o que você mais ouviu este ano.</div></div>
            <span className="relative h-10 px-5 rounded-full bg-white text-black font-semibold inline-flex items-center">Abrir</span>
          </motion.button>
        )}
        {ordered}
      </>)}
    </div>
  );
}
