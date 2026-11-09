import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, CircleUser, Clock, History as HistoryIcon, ListPlus, LogIn, LogOut, Pause, Play, Search, Trash2, TrendingUp, X, Check, Settings } from "lucide-react";
import { artistOf, getAlbum, getArtist, getTrack, playlists, podcasts, sample, albums, artists } from "../lib/catalog";
import { BrandTile, type BrandId } from "../lib/brands";
import { cx, dayLabel, fmtLong, fmtNum, norm } from "../lib/util";
import { useLib, type HistoryEntry } from "../store/library";
import { usePlayer } from "../store/player";
import { nav, openDialog, toast, useUI } from "../store/ui";
import { Grid, MediaCard, TrackList } from "../components/media";
import { Btn, Chip, Cover, coverBg, Empty, IconBtn, SectionTitle, Segmented } from "../components/ui";
import { useYt } from "../lib/account";
import { isTauri } from "../lib/native";
import YtLibraryView, { type YtKind } from "./YtLibraryView";

// ───────── Histórico
export function HistoryPage() {
  const history = useLib((s) => s.history), spotify = useLib((s) => s.accounts.spotify);
  const [src, setSrc] = useState<"local" | "remote" | "spotify">("local");
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    // "Remoto" simula o histórico da conta: mesma base, deslocada.
    const base = src === "local" ? history : history.filter((_, i) => i % (src === "remote" ? 2 : 3) === 0);
    const out: { label: string; items: HistoryEntry[] }[] = [];
    for (const h of base.slice(0, 220)) {
      const t = getTrack(h.id); if (!t || (q && !norm(`${t.title} ${artistOf(t)}`).includes(norm(q)))) continue;
      const label = dayLabel(h.at);
      if (out[out.length - 1]?.label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push(h);
    }
    return out;
  }, [history, src, q]);
  return (
    <div className="px-8 pt-5 pb-10">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <h1 className="text-[2.1rem] font-bold tracking-tight flex-1">Histórico</h1>
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-t3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar no histórico" className="w-56 h-9 pl-9 pr-3 rounded-full bg-s2 placeholder:text-t3 text-[0.88rem]" /></div>
        <Segmented id="hist" value={src} onChange={setSrc} options={[["local", "Local"], ["remote", "Conta"], ["spotify", "Spotify"]]} />
        <IconBtn label="Limpar histórico" onClick={() => openDialog("confirm", { title: "Limpar o histórico de escuta?", text: "Todo o histórico local será apagado. As estatísticas deixam de contar essas reproduções.", confirm: "Limpar", danger: true, action: () => { useLib.getState().clear("history"); toast("Histórico limpo"); } })}><Trash2 /></IconBtn>
      </div>
      {src === "remote" && isTauri ? (useYt.getState().info ? <YtLibraryView kind="history" filter={q} /> : <Empty icon={<LogIn />} title="Entre no YouTube Music para ver o histórico da conta" text="O que você ouve no MetroMusic também aparece no histórico oficial do YouTube Music."><Btn variant="primary" onClick={() => openDialog("login", { service: "youtube" })}>Entrar</Btn></Empty>)
        : src === "spotify" && !spotify ? <Empty icon={<LogIn />} title="Entre no Spotify para ver seu histórico de escuta" text="O MetroMusic pode mostrar e sincronizar o que você ouve com a sua conta do Spotify."><Btn variant="primary" onClick={() => nav("settings/spotify")}>Conectar Spotify</Btn></Empty>
        : groups.length === 0 ? <Empty icon={<HistoryIcon />} title={q ? "Nenhum resultado encontrado" : "Nada no histórico"} text={q ? undefined : "As músicas que você ouvir aparecem aqui."} />
        : groups.map((g) => (
          <section key={g.label} className="mb-7 -mx-3">
            <div className="px-3 flex items-center gap-3 mb-1"><h2 className="text-[1.15rem] font-semibold flex-1">{g.label}</h2><Btn size="sm" variant="ghost" icon={<Play />} onClick={() => usePlayer.getState().play([...new Set(g.items.map((h) => h.id))], 0, `Histórico: ${g.label}`)}>Tocar</Btn></div>
            <TrackList ids={g.items.map((h) => h.id)} title={`Histórico: ${g.label}`} header={false} dense ctxOf={(_, i) => ({ historyAt: src === "local" ? g.items[i].at : undefined })}
              dateOf={(_, i) => new Date(g.items[i].at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} />
          </section>
        ))}
    </div>
  );
}

// ───────── Estatísticas
const PERIODS: [string, string, number][] = [["day", "24 horas", 1], ["week", "Semana", 7], ["month", "Mês", 30], ["year", "Ano", 365], ["all", "Tudo", 100000]];
function useStats(days: number) {
  const history = useLib((s) => s.history);
  return useMemo(() => {
    const lim = Date.now() - days * 864e5;
    const hs = history.filter((h) => h.at >= lim);
    const cs: Record<string, number> = {}, ca: Record<string, number> = {}, cl: Record<string, number> = {};
    let seconds = 0;
    for (const h of hs) { const t = getTrack(h.id); if (!t || t.episode) continue; cs[t.id] = (cs[t.id] ?? 0) + 1; if (getArtist(t.artistId)) ca[t.artistId] = (ca[t.artistId] ?? 0) + t.duration; if (t.albumId && getAlbum(t.albumId)) cl[t.albumId] = (cl[t.albumId] ?? 0) + t.duration; /* faixas sem álbum (vídeos, uploads) não entram no ranking de álbuns */ seconds += t.duration; }
    const rank = (c: Record<string, number>) => Object.entries(c).sort((a, b) => b[1] - a[1]);
    // histograma: por hora (24 h), por dia (semana/mês) ou por mês
    const n = days === 1 ? 24 : days <= 7 ? 7 : days <= 30 ? 30 : 12;
    const span = days === 1 ? 36e5 : days <= 30 ? 864e5 : 30.4 * 864e5;
    const bars = Array.from({ length: n }, () => 0);
    for (const h of hs) { const i = n - 1 - Math.floor((Date.now() - h.at) / span); if (i >= 0 && i < n) bars[i] += (getTrack(h.id)?.duration ?? 0) / 60; }
    return { plays: hs.length, seconds, songs: rank(cs), artists: rank(ca), albums: rank(cl), bars, span, n };
  }, [history, days]);
}

export function StatsPage() {
  const [period, setPeriod] = useState("month");
  const [tab, setTab] = useState<"songs" | "artists" | "albums">("songs");
  const days = PERIODS.find((p) => p[0] === period)![2];
  const st = useStats(days);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...st.bars);
  const barLabel = (i: number) => { const d = new Date(Date.now() - (st.n - 1 - i) * st.span); return days === 1 ? `${d.getHours()}h` : days <= 30 ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : d.toLocaleDateString("pt-BR", { month: "short" }); };
  const tiles: [string, string][] = [["Tempo ouvido", fmtLong(st.seconds)], ["Reproduções", fmtNum(st.plays)], ["Músicas diferentes", fmtNum(st.songs.length)], ["Artistas diferentes", fmtNum(st.artists.length)]];
  const topIds = st.songs.slice(0, 50).map(([id]) => id);
  return (
    <div className="px-8 pt-5 pb-10">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <h1 className="text-[2.1rem] font-bold tracking-tight flex-1">Estatísticas</h1>
        <Segmented id="period" value={period} onChange={setPeriod} options={PERIODS.map(([v, l]) => [v, l] as [string, string])} />
      </div>
      {st.plays === 0 ? <Empty icon={<TrendingUp />} title="Sem dados neste período" text="Ouça algumas músicas e volte aqui." /> : (<>
        <div className="grid grid-cols-4 max-[1000px]:grid-cols-2 gap-3 mb-6">{tiles.map(([l, v]) => <div key={l} className="rounded-2xl bg-s1 p-5"><div className="text-t3 text-[0.84rem] font-medium">{l}</div><div className="text-[1.9rem] font-bold tracking-tight tnum mt-0.5">{v}</div></div>)}</div>
        <div className="rounded-2xl bg-s1 p-5 mb-8">
          <div className="flex items-baseline gap-3 mb-4"><div className="font-semibold">Minutos ouvidos</div><div className="text-t3 text-[0.84rem] tnum">{hover !== null ? `${barLabel(hover)} · ${Math.round(st.bars[hover])} min` : `por ${days === 1 ? "hora" : days <= 30 ? "dia" : "mês"}`}</div></div>
          <div className="flex items-end gap-[3px] h-36" onMouseLeave={() => setHover(null)}>
            {st.bars.map((v, i) => (
              <div key={i} className="flex-1 h-full flex items-end" onMouseEnter={() => setHover(i)}>
                <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(v > 0 ? 3 : 1, (v / max) * 100)}%` }} transition={{ duration: 0.5, delay: i * 0.012, ease: [0.22, 1, 0.36, 1] }} className={cx("w-full rounded-t-[4px] transition-colors", hover === i ? "bg-accent" : v > 0 ? "bg-accent/55" : "bg-s3")} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-t3 text-[0.74rem] tnum mt-2"><span>{barLabel(0)}</span><span>{barLabel(Math.floor(st.n / 2))}</span><span>{days === 1 ? "agora" : barLabel(st.n - 1)}</span></div>
        </div>
        <div className="flex items-center gap-2 mb-4">
          <Chip active={tab === "songs"} onClick={() => setTab("songs")}>Músicas mais ouvidas</Chip><Chip active={tab === "artists"} onClick={() => setTab("artists")}>Artistas</Chip><Chip active={tab === "albums"} onClick={() => setTab("albums")}>Álbuns</Chip>
          <div className="flex-1" />
          {tab === "songs" && <><Btn size="sm" variant="ghost" icon={<ListPlus />} onClick={() => openDialog("createPlaylist", { trackIds: topIds })}>Salvar como playlist</Btn><Btn size="sm" icon={<Play />} onClick={() => usePlayer.getState().play(topIds, 0, "Mais ouvidas")}>Tocar</Btn></>}
        </div>
        {tab === "songs" && <div className="-mx-3">{st.songs.slice(0, 25).map(([id, n], i) => { const t = getTrack(id)!; return (
          <div key={id} className="group flex items-center gap-4 h-14 px-3 rounded-lg hover:bg-s2" onDoubleClick={() => usePlayer.getState().play(topIds, i, "Mais ouvidas")}>
            <span className="w-6 text-center text-t3 tnum font-semibold">{i + 1}</span><Cover hue={t.hue} seed={t.seed} src={t.art} className="size-10 rounded-md" />
            <div className="min-w-0 w-[32%]"><div className="truncate font-medium">{t.title}</div><div className="truncate text-t3 text-[0.84rem]">{artistOf(t)}</div></div>
            <div className="flex-1 h-1.5 rounded-full bg-s2 overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${(n / st.songs[0][1]) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.02 }} className="h-full rounded-full bg-accent" /></div>
            <span className="w-24 text-right text-t2 tnum text-[0.88rem]">{n} {n === 1 ? "vez" : "vezes"}</span>
          </div>); })}</div>}
        {tab === "artists" && <Grid>{st.artists.slice(0, 18).map(([id, sec]) => <MediaCard key={id} item={{ type: "artist", id }} sub={fmtLong(sec)} />)}</Grid>}
        {tab === "albums" && <Grid>{st.albums.slice(0, 18).map(([id, sec]) => <MediaCard key={id} item={{ type: "album", id }} sub={`${getArtist(getAlbum(id)!.artistId)?.name} · ${fmtLong(sec)}`} />)}</Grid>}
      </>)}
    </div>
  );
}

// ───────── Retrospectiva (stories)
export function WrappedPage() {
  const st = useStats(365);
  const [i, setI] = useState(0); const [paused, setPaused] = useState(false);
  const minutes = Math.round(st.seconds / 60);
  const topSong = getTrack(st.songs[0]?.[0] ?? ""), topArtist = getArtist(st.artists[0]?.[0] ?? ""), topAlbum = getAlbum(st.albums[0]?.[0] ?? "");
  const Big = ({ children }: { children: React.ReactNode }) => <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 16, delay: 0.25 }} className="text-[5.5rem] font-black tracking-tighter leading-none tnum">{children}</motion.div>;
  const T = ({ children, d = 0.1 }: { children: React.ReactNode; d?: number }) => <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: d, duration: 0.5 }}>{children}</motion.div>;
  const Top5 = ({ rows }: { rows: { title: string; sub: string; hue: number; seed: number; artist?: boolean }[] }) => <div className="w-full max-w-md space-y-2.5 mt-6">{rows.map((r, k) => <motion.div key={k} initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 + k * 0.12 }} className="flex items-center gap-4 p-2.5 rounded-2xl bg-white/12 backdrop-blur text-left"><span className="w-7 text-center text-[1.4rem] font-black">{k + 1}</span><Cover hue={r.hue} seed={r.seed} artist={r.artist} className="size-12" /><div className="min-w-0"><div className="font-bold truncate">{r.title}</div><div className="text-white/70 text-[0.86rem] truncate">{r.sub}</div></div></motion.div>)}</div>;
  const pages: { hue: number; body: React.ReactNode }[] = !topSong || !topArtist || !topAlbum ? [{ hue: 280, body: <T><div className="text-[1.6rem] font-bold">Ainda não há dados suficientes</div><div className="text-white/75 mt-2">Ouça mais músicas para gerar a sua retrospectiva.</div></T> }] : [
    { hue: 300, body: <><T><div className="text-[1rem] font-bold tracking-[0.4em]">METROMUSIC</div></T><Big>2026</Big><T d={0.5}><div className="text-[1.3rem] text-white/85 max-w-sm mt-4">Chegou a hora de ver o que você ouviu ao longo do ano…</div></T></> },
    { hue: 250, body: <><T><div className="text-[1.5rem] font-bold">Você passou muito tempo de fone.</div></T><T d={0.8}><div className="text-white/80 text-[1.2rem] mt-3">Quer saber quanto?</div></T></> },
    { hue: 210, body: <><T><div className="text-[1.3rem]">Você ouviu</div></T><Big>{fmtNum(minutes)}</Big><T d={0.5}><div className="text-[1.3rem]">minutos de música</div><div className="text-white/70 mt-2">São {Math.round(minutes / 60 / 24 * 10) / 10} dias inteiros de som.</div></T></> },
    { hue: 170, body: <><T><div className="text-[1.3rem]">Você ouviu</div></T><Big>{st.songs.length}</Big><T d={0.5}><div className="text-[1.3rem]">músicas diferentes!</div></T></> },
    { hue: topSong.hue, body: <><T><div className="text-[1.3rem]">Sua música mais tocada foi</div></T><motion.div initial={{ scale: 0.5, rotate: -8, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", delay: 0.3 }} className="my-6"><Cover hue={topSong.hue} seed={topSong.seed} src={topSong.art} className="size-56 rounded-3xl shadow-2xl" /></motion.div><T d={0.5}><div className="text-[2rem] font-black tracking-tight">{topSong.title}</div><div className="text-white/80 text-[1.1rem]">{artistOf(topSong)} · {st.songs[0][1]} reproduções</div></T></> },
    { hue: 30, body: <><T><div className="text-[1.5rem] font-bold">Suas músicas do ano</div></T><Top5 rows={st.songs.slice(0, 5).map(([id, n]) => { const t = getTrack(id)!; return { title: t.title, sub: `${artistOf(t)} · ${n} vezes`, hue: t.hue, seed: t.seed }; })} /></> },
    { hue: 120, body: <><T><div className="text-[1.3rem]">Você ouviu</div></T><Big>{st.artists.length}</Big><T d={0.5}><div className="text-[1.3rem]">artistas diferentes!</div></T></> },
    { hue: topArtist.hue, body: <><T><div className="text-[1.3rem]">Seu artista do ano é</div></T><motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", delay: 0.3 }} className="my-6"><Cover hue={topArtist.hue} seed={topArtist.seed} artist className="size-56 shadow-2xl" /></motion.div><T d={0.5}><div className="text-[2.2rem] font-black tracking-tight">{topArtist.name}</div><div className="text-white/80 text-[1.1rem]">Você ouviu por {fmtNum(Math.round(st.artists[0][1] / 60))} minutos!</div></T></> },
    { hue: 330, body: <><T><div className="text-[1.5rem] font-bold">Seus artistas do ano</div></T><Top5 rows={st.artists.slice(0, 5).map(([id, s]) => { const a = getArtist(id)!; return { title: a.name, sub: `${fmtNum(Math.round(s / 60))} minutos`, hue: a.hue, seed: a.seed, artist: true }; })} /></> },
    { hue: topAlbum.hue + 20, body: <><T><div className="text-[1.3rem]">Seu álbum do ano é</div></T><motion.div initial={{ scale: 0.5, rotate: 8, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", delay: 0.3 }} className="my-6"><Cover hue={topAlbum.hue} seed={topAlbum.seed} className="size-56 rounded-3xl shadow-2xl" /></motion.div><T d={0.5}><div className="text-[2rem] font-black tracking-tight">{topAlbum.title}</div><div className="text-white/80 text-[1.1rem]">{getArtist(topAlbum.artistId)?.name} · {fmtNum(Math.round(st.albums[0][1] / 60))} minutos</div></T></> },
    { hue: 60, body: <><T><div className="text-[1.5rem] font-bold">Seus 5 álbuns do ano</div></T><Top5 rows={st.albums.slice(0, 5).map(([id, s]) => { const a = getAlbum(id)!; return { title: a.title, sub: `${getArtist(a.artistId)?.name} · ${fmtNum(Math.round(s / 60))} minutos`, hue: a.hue, seed: a.seed }; })} /></> },
    { hue: 280, body: <><T><div className="text-[1.8rem] font-black tracking-tight">Sua playlist pessoal está pronta!</div><div className="text-white/80 mt-2 mb-6">As 50 que marcaram o seu 2026, num lugar só.</div></T><T d={0.4}><button onClick={(e) => { e.stopPropagation(); const id = useLib.getState().createPlaylist("Retrospectiva 2026", st.songs.slice(0, 50).map(([s]) => s)); toast("Playlist salva", { label: "Abrir", fn: () => nav(`playlist/${id}`) }); }} className="h-12 px-7 rounded-full bg-white text-black font-bold inline-flex items-center gap-2 hover:scale-105 transition-transform"><ListPlus className="size-5" />Criar playlist</button></T></> },
    { hue: 200, body: <><T><div className="text-[2.4rem] font-black tracking-tight">Obrigado por ouvir!</div><div className="text-white/80 text-[1.1rem] mt-3">Até a próxima retrospectiva.</div></T><T d={0.5}><button onClick={(e) => { e.stopPropagation(); nav("home"); }} className="mt-7 h-12 px-7 rounded-full bg-white/20 hover:bg-white/30 font-bold">Fechar a retrospectiva</button></T></> },
  ];
  const last = pages.length - 1;
  useEffect(() => { if (paused || i >= last) return; const t = setTimeout(() => setI((v) => Math.min(last, v + 1)), 5200); return () => clearTimeout(t); }, [i, paused, last]);
  const p = pages[Math.min(i, last)];
  return (
    <div className="h-[calc(100vh-9.2rem)] p-5 flex justify-center">
      <div className="relative h-full aspect-[9/14] max-w-full rounded-3xl overflow-hidden text-white shadow-2xl" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setI((v) => (e.clientX - r.left < r.width * 0.3 ? Math.max(0, v - 1) : Math.min(last, v + 1))); }}>
        <AnimatePresence initial={false}>
          <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} className="absolute inset-0" style={{ background: `linear-gradient(160deg, oklch(0.55 0.2 ${p.hue}), oklch(0.32 0.15 ${(p.hue + 50) % 360}) 60%, oklch(0.2 0.08 ${(p.hue + 90) % 360}))` }}>
            <div className="absolute -top-24 -left-24 size-96 rounded-full blur-3xl opacity-50 drift" style={{ background: `oklch(0.75 0.18 ${(p.hue + 60) % 360})` }} />
            <div className="absolute -bottom-32 -right-20 size-[28rem] rounded-full blur-3xl opacity-40 drift-rev" style={{ background: `oklch(0.7 0.2 ${(p.hue + 300) % 360})` }} />
          </motion.div>
        </AnimatePresence>
        <div className="absolute top-4 inset-x-4 flex gap-1 z-10">{pages.map((_, k) => <div key={k} className="flex-1 h-[3px] rounded-full bg-white/25 overflow-hidden">{k < i ? <div className="h-full bg-white" /> : k === i ? <motion.div key={`${i}-${paused}`} initial={{ width: "0%" }} animate={{ width: paused ? "40%" : "100%" }} transition={{ duration: paused ? 0 : 5.2, ease: "linear" }} className="h-full bg-white" /> : null}</div>)}</div>
        <div className="absolute top-8 right-4 z-10 flex gap-1"><IconBtn label={paused ? "Continuar" : "Pausar"} className="!text-white hover:!bg-white/15" onClick={(e) => { e.stopPropagation(); setPaused(!paused); }}>{paused ? <Play /> : <Pause />}</IconBtn><IconBtn label="Fechar" className="!text-white hover:!bg-white/15" onClick={(e) => { e.stopPropagation(); nav("home"); }}><X /></IconBtn></div>
        <div key={i} className="relative h-full flex flex-col items-center justify-center text-center px-10">{p.body}</div>
        <div className="absolute bottom-5 inset-x-0 flex justify-center gap-6 text-white/50 text-[0.76rem] pointer-events-none"><span className="inline-flex items-center gap-1"><ChevronLeft className="size-3.5" />voltar</span><span className="inline-flex items-center gap-1">avançar<ChevronRight className="size-3.5" /></span></div>
      </div>
    </div>
  );
}

// ───────── Conta
const SERVICE_LIST: [string, string, number, string][] = [["youtube", "YouTube Music", 25, "Início, biblioteca e sincronização"], ["deezer", "Deezer", 300, "Reprodução em FLAC e letras"], ["tidal", "TIDAL", 220, "Hi-Res e capas animadas"], ["spotify", "Spotify", 150, "Canvas, início e histórico"], ["soundcloud", "SoundCloud", 50, "Início personalizado"], ["lastfm", "Last.fm", 10, "Scrobbling"], ["discord", "Discord", 265, "Rich Presence"]];
export function AccountPage() {
  const accounts = useLib((s) => s.accounts), saved = useLib((s) => s.savedPlaylists), savedAlbums = useLib((s) => s.savedAlbums), followed = useLib((s) => s.followed), subs = useLib((s) => s.subscribedPodcasts);
  const [tab, setTab] = useState(isTauri ? "songs" : "playlists");
  const yt = accounts.youtube; const info = useYt((s) => s.info); const real = isTauri;
  return (
    <div className="px-8 pt-5 pb-10">
      <div className="flex items-center gap-5 p-6 rounded-3xl bg-s1 mb-8 relative overflow-hidden">
        <div className="absolute -right-20 -top-20 size-72 rounded-full blur-3xl opacity-30 bg-accent" />
        <div className="relative size-20 rounded-full bg-accent text-accent-fg grid place-items-center text-[2rem] font-bold overflow-hidden">{info?.avatar ? <img src={info.avatar} alt="" referrerPolicy="no-referrer" className="size-full object-cover" /> : yt ? yt[0].toUpperCase() : <CircleUser className="size-9" />}</div>
        <div className="relative flex-1 min-w-0"><div className="text-[1.6rem] font-bold tracking-tight">{yt ?? "Convidado"}</div><div className="text-t3">{yt ? `${info?.email ?? info?.handle ?? "Conta do Google"} · YouTube Music` : "Entre para sincronizar a biblioteca e receber recomendações"}</div></div>
        <Btn variant="ghost" icon={<Settings />} onClick={() => nav("settings/integrations")}>Integrações</Btn>
        {yt ? <Btn variant="outline" icon={<LogOut />} onClick={() => openDialog("logout")}>Sair</Btn> : <Btn variant="primary" icon={<LogIn />} onClick={() => openDialog("login", { service: "youtube" })}>Entrar</Btn>}
      </div>
      <SectionTitle>Serviços conectados</SectionTitle>
      <div className="grid gap-3 mb-10" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(17rem, 1fr))" }}>
        {SERVICE_LIST.map(([id, name, hue, desc]) => (
          <button key={id} onClick={() => nav(`settings/${id === "youtube" ? "privacy" : id}`)} className="flex items-center gap-3.5 p-4 rounded-2xl bg-s1 hover:bg-s2 text-left transition-colors">
            <BrandTile id={id as BrandId} size={44} />
            <div className="min-w-0 flex-1"><div className="font-semibold">{name}</div><div className="text-t3 text-[0.82rem] truncate">{accounts[id] ? `Conectado como ${accounts[id]}` : desc}</div></div>
            {accounts[id] ? <Check className="size-5 text-ok" /> : <span className="text-accent text-[0.84rem] font-semibold">Conectar</span>}
          </button>
        ))}
      </div>
      {yt && real ? (<>
        <SectionTitle sub="Conteúdo salvo no YouTube Music">Na sua conta</SectionTitle>
        <div className="flex gap-2 mb-5">{[["songs", "Curtidas"], ["playlists", "Playlists"], ["albums", "Álbuns"], ["artists", "Artistas"], ["history", "Histórico"]].map(([v, l]) => <Chip key={v} active={tab === v} onClick={() => setTab(v)}>{l}</Chip>)}</div>
        <YtLibraryView kind={(["songs", "playlists", "albums", "artists", "history"].includes(tab) ? tab : "songs") as YtKind} />
      </>) : yt ? (<>
        <SectionTitle sub="Conteúdo salvo no YouTube Music">Na sua conta</SectionTitle>
        <div className="flex gap-2 mb-5">{[["playlists", "Playlists"], ["albums", "Álbuns"], ["artists", "Artistas"], ["podcasts", "Podcasts"]].map(([v, l]) => <Chip key={v} active={tab === v} onClick={() => setTab(v)}>{l}</Chip>)}</div>
        <Grid>
          {tab === "playlists" && [...saved, ...playlists.filter((p) => p.kind === "editorial").slice(4).map((p) => p.id)].map((id) => <MediaCard key={id} item={{ type: "playlist", id }} />)}
          {tab === "albums" && savedAlbums.map((id) => <MediaCard key={id} item={{ type: "album", id }} />)}
          {tab === "artists" && followed.map((id) => <MediaCard key={id} item={{ type: "artist", id }} />)}
          {tab === "podcasts" && [...subs, ...podcasts.map((p) => p.id).filter((id) => !subs.includes(id))].map((id) => <MediaCard key={id} item={{ type: "podcast", id }} />)}
        </Grid>
        {tab === "podcasts" && <div className="flex gap-3 mt-8"><Btn icon={<Clock />} onClick={() => nav("playlist/later")}>Episódios para depois</Btn><Btn variant="ghost" onClick={() => nav("library/podcasts")}>Episódios novos</Btn></div>}
      </>) : <Empty icon={<CircleUser />} title="Você não está conectado" text="Entre com a sua conta para ver playlists, álbuns e artistas salvos."><Btn variant="primary" onClick={() => openDialog("login", { service: "youtube" })}>Entrar</Btn></Empty>}
    </div>
  );
}
export { sample, albums, artists, coverBg, useUI };
