import { useRef, useState } from "react";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { AudioLines, Cast, ChevronDown, Ellipsis, Gauge, GripVertical, Heart, Info, ListMusic, ListPlus, Maximize2, MicVocal, Minimize2, Moon, Pause, PictureInPicture2, Play, Repeat, Repeat1, RotateCcw, Share2, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Trash2, TriangleAlert, Volume1, Volume2, VolumeX, Waypoints, X, Copy } from "lucide-react";
import { artistOf, albumOf, getArtist, getTrack, getTracks, sourceName, type Track } from "../lib/catalog";
import { sleepMenu, trackMenu } from "../lib/menus";
import { copyText, cx, fmtCount, fmtLong, fmtTime } from "../lib/util";
import { useLib } from "../store/library";
import { useCurrent, usePlayer, useProvider } from "../store/player";
import { useSetting } from "../store/settings";
import { nav, openDialog, toast, useUI } from "../store/ui";
import { LyricLineNow, LyricsMenuButton, LyricsView } from "./Lyrics";
import { SourceIcon } from "../lib/brands";
import { isNativeMac } from "../lib/native";
import { WindowControls } from "./WindowControls";
import { Badge, Btn, Cover, coverBg, Empty, Eq, Explicit, IconBtn, Range, Segmented, Spinner } from "./ui";

// ───────── Barra de progresso
const WAVE = (w: number, a: number) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='12'%3E%3Cpath d='M0 6 Q${w / 4} ${6 - a} ${w / 2} 6 T${w} 6' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E")`;

export function Seek({ times = "side", className }: { times?: "side" | "below" | "none"; className?: string }) {
  const t = useCurrent();
  const pos = usePlayer((s) => s.position), playing = usePlayer((s) => s.playing);
  const style = useSetting<string>("sliderStyle");
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dur = t?.duration ?? 0;
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  const p = dur ? (drag ?? pos / dur) : 0;
  const wavy = style === "wavy" || style === "squiggly";
  const bar = (
    <div ref={ref} role="slider" aria-label="Posição" aria-valuemin={0} aria-valuemax={dur} aria-valuenow={Math.round(pos)} tabIndex={0}
      className="group relative flex-1 h-5 flex items-center cursor-pointer touch-none"
      onPointerDown={(e) => { if (!dur) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)); }}
      onPointerMove={(e) => { setHover(at(e)); if (drag !== null) setDrag(at(e)); }}
      onPointerUp={(e) => { if (drag !== null) { usePlayer.getState().seek(at(e) * dur); setDrag(null); } }}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => { if (e.key === "ArrowRight") usePlayer.getState().seek(pos + 5); if (e.key === "ArrowLeft") usePlayer.getState().seek(pos - 5); }}>
      <div className={cx("absolute inset-x-0 rounded-full bg-t1/15 transition-[height]", style === "slim" ? "h-0.5 group-hover:h-1" : "h-1 group-hover:h-1.5")} />
      {wavy ? (
        <div className="absolute left-0 h-3 bg-accent" style={{ width: `${p * 100}%`, maskImage: WAVE(style === "wavy" ? 26 : 14, style === "wavy" ? 4 : 5.5), WebkitMaskImage: WAVE(style === "wavy" ? 26 : 14, style === "wavy" ? 4 : 5.5), maskRepeat: "repeat-x", WebkitMaskRepeat: "repeat-x", animation: playing ? "wave 1.1s linear infinite" : undefined }} />
      ) : (
        <div className={cx("absolute left-0 rounded-full bg-accent transition-[height]", style === "slim" ? "h-0.5 group-hover:h-1" : "h-1 group-hover:h-1.5")} style={{ width: `${p * 100}%` }} />
      )}
      <div className={cx("absolute size-3.5 -ml-1.75 rounded-full bg-t1 shadow-md transition-transform duration-150", drag !== null ? "scale-110" : wavy ? "scale-100" : "scale-0 group-hover:scale-100")} style={{ left: `${p * 100}%` }} />
      {hover !== null && dur > 0 && <div className="absolute -top-8 -translate-x-1/2 px-2 h-6 grid place-items-center rounded-md bg-s3 text-[0.76rem] tnum font-medium pointer-events-none shadow-lg" style={{ left: `${(drag ?? hover) * 100}%` }}>{fmtTime((drag ?? hover) * dur)}</div>}
    </div>
  );
  const cur = fmtTime(drag !== null ? drag * dur : pos), end = fmtTime(dur);
  if (times === "none") return <div className={cx("flex", className)}>{bar}</div>;
  if (times === "below") return <div className={className}><div className="flex">{bar}</div><div className="flex justify-between text-t2 text-[0.8rem] tnum mt-1"><span>{cur}</span><span>{end}</span></div></div>;
  return <div className={cx("flex items-center gap-2.5 text-t3 text-[0.76rem] tnum", className)}><span className="w-9 text-right">{cur}</span>{bar}<span className="w-9">{end}</span></div>;
}

function PlayButton({ size = 40, big }: { size?: number; big?: boolean }) {
  const playing = usePlayer((s) => s.playing), buffering = usePlayer((s) => s.buffering), toggle = usePlayer((s) => s.toggle);
  const style = useSetting<string>("playerButtons");
  return (
    <button aria-label={playing ? "Pausar (Espaço)" : "Tocar (Espaço)"} title={playing ? "Pausar (Espaço)" : "Tocar (Espaço)"} onClick={toggle} style={{ width: size, height: size }}
      className={cx("relative grid place-items-center rounded-full shrink-0 transition-transform duration-150 hover:scale-105 active:scale-92", style === "default" ? "bg-t1 text-bg" : style === "primary" ? "bg-accent text-accent-fg" : "bg-s3 text-t1")}>
      {buffering && <span className="absolute -inset-1 rounded-full border-2 border-accent border-t-transparent animate-spin" />}
      <motion.span key={playing ? "p" : "s"} initial={{ scale: 0.6, rotate: -25 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 600, damping: 26 }} className="relative grid place-items-center">
        {playing ? <Pause style={{ width: size * (big ? 0.4 : 0.45), height: size * (big ? 0.4 : 0.45) }} fill="currentColor" strokeWidth={0} /> : <Play style={{ width: size * 0.45, height: size * 0.45, marginLeft: size * 0.06 }} fill="currentColor" strokeWidth={0} />}
      </motion.span>
    </button>
  );
}

function Transport({ big }: { big?: boolean }) {
  const shuffle = usePlayer((s) => s.shuffle), repeat = usePlayer((s) => s.repeat);
  const P = usePlayer.getState();
  const s = big ? 46 : 34;
  return (
    <div className={cx("flex items-center justify-center", big ? "gap-5" : "gap-2.5")}>
      <IconBtn label={shuffle ? "Aleatório ligado (S)" : "Aleatório (S)"} active={shuffle} size={s} onClick={P.toggleShuffle}><Shuffle /></IconBtn>
      <IconBtn label="Anterior (Ctrl+←)" size={s} onClick={P.prev} className="text-t1 [&>svg]:size-5"><SkipBack fill="currentColor" /></IconBtn>
      <PlayButton size={big ? 68 : 40} big={big} />
      <IconBtn label="Próxima (Ctrl+→)" size={s} onClick={() => P.next()} className="text-t1 [&>svg]:size-5"><SkipForward fill="currentColor" /></IconBtn>
      <IconBtn label={repeat === "off" ? "Repetir (R)" : repeat === "all" ? "Repetindo a fila (R)" : "Repetindo esta música (R)"} active={repeat !== "off"} size={s} onClick={P.cycleRepeat}>{repeat === "one" ? <Repeat1 /> : <Repeat />}</IconBtn>
    </div>
  );
}

export function QualityBadge({ t, onClick }: { t: Track; onClick?: () => void }) {
  const provider = useProvider(t)!;
  const label = t.tier === "Hi-Res" ? "Hi-Res Lossless" : t.tier === "Lossless" ? "Lossless" : t.tier === "Atmos" ? "Dolby Atmos" : `${t.format} ${t.bitrate}`;
  return (
    <button title={`${sourceName(provider)} · ${t.format} · ${t.bitrate} · ${t.sampleRate}\nClique para escolher a fonte`} onClick={onClick ?? (() => openDialog("source", { id: t.id }))}
      className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-t1/8 hover:bg-t1/14 text-t2 text-[0.7rem] font-semibold tracking-wide uppercase whitespace-nowrap transition-colors">
      {t.tier && <AudioLines className="size-3.5 text-accent" />}{label}<span className="text-t3 normal-case font-medium inline-flex items-center gap-1.5">· <SourceIcon id={provider} size={13} />{sourceName(provider)}</span>
    </button>
  );
}

function LikeBtn({ id, size = 34 }: { id: string; size?: number }) {
  const liked = useLib((s) => s.liked.includes(id));
  return (
    <IconBtn label={liked ? "Remover curtida (L)" : "Curtir (L)"} size={size} onClick={() => useLib.getState().toggleLike(id)} className={liked ? "!text-accent" : ""}>
      <motion.span key={String(liked)} initial={{ scale: liked ? 0.4 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 14 }} className="grid"><Heart className="size-[1.15rem]" fill={liked ? "currentColor" : "none"} /></motion.span>
    </IconBtn>
  );
}

function Volume() {
  const volume = usePlayer((s) => s.volume), muted = usePlayer((s) => s.muted);
  const v = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-1 group/vol" onWheel={(e) => usePlayer.getState().setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))}>
      <IconBtn label={muted ? "Ativar som (M)" : "Silenciar (M)"} size={34} onClick={usePlayer.getState().toggleMute}>{v === 0 ? <VolumeX /> : v < 0.5 ? <Volume1 /> : <Volume2 />}</IconBtn>
      <Range label="Volume" value={v} onChange={(x) => usePlayer.getState().setVolume(x)} className="w-24" fill="var(--t1)" />
    </div>
  );
}

// ───────── Barra do player (sempre visível)
export function PlayerBar() {
  const t = useCurrent();
  const panel = useUI((s) => s.panel), togglePanel = useUI((s) => s.togglePanel), setNowPlaying = useUI((s) => s.setNowPlaying), openMenu = useUI((s) => s.openMenu), openMenuAt = useUI((s) => s.openMenuAt);
  const sleep = usePlayer((s) => s.sleep), error = usePlayer((s) => s.error), speed = usePlayer((s) => s.speed);
  const bg = useSetting<string>("miniPlayerBackground"), hideThumb = useSetting<boolean>("hidePlayerThumbnail"), legacy = useSetting<boolean>("legacyQualityLabel");
  if (!t) return (
    <footer className="h-[5.6rem] shrink-0 border-t border-line bg-s1 grid place-items-center text-t3">Nenhuma música tocando — escolha algo para começar.</footer>
  );
  return (
    <footer className={cx("relative h-[5.6rem] shrink-0 border-t border-line grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] items-center gap-4 px-4", bg === "transparent" ? "bg-s1/60 backdrop-blur-2xl" : "bg-s1")}
      onContextMenu={(e) => openMenu(e, trackMenu(t))}>
      {bg === "tinted" && <div className="absolute inset-0 pointer-events-none transition-[background] duration-700" style={{ background: `linear-gradient(100deg, oklch(0.5 0.13 ${t.hue} / 0.2), transparent 45%)` }} />}
      {/* faixa atual */}
      <div className="relative flex items-center gap-3.5 min-w-0">
        <button aria-label="Abrir Tocando agora (F)" title="Abrir Tocando agora (F)" onClick={() => setNowPlaying(true)} className="group relative shrink-0">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={t.id} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.22 }}>
              {hideThumb ? <div className="size-14 rounded-lg bg-s3 grid place-items-center text-accent"><AudioLines /></div> : <Cover hue={t.hue} seed={t.seed} className="size-14 rounded-lg shadow-lg shadow-black/30" />}
            </motion.div>
          </AnimatePresence>
          <span className="absolute inset-0 rounded-lg bg-black/55 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"><Maximize2 className="size-5 text-white" /></span>
        </button>
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }} className="min-w-0">
              <button className="block max-w-full truncate font-semibold hover:underline text-left" onClick={() => nav(t.episode ? `podcast/${t.podcastId}` : `album/${t.albumId}`)}>{t.title}</button>
              <div className="flex items-center gap-1.5 text-t3 text-[0.84rem] min-w-0">{t.explicit && <Explicit />}<button className="truncate hover:underline hover:text-t1" onClick={() => nav(t.episode ? `podcast/${t.podcastId}` : `artist/${t.artistId}`)}>{artistOf(t)}</button></div>
            </motion.div>
          </AnimatePresence>
        </div>
        <LikeBtn id={t.id} />
      </div>
      {/* transporte */}
      <div className="relative flex flex-col gap-1 min-w-0">
        {error ? (
          <div className="flex items-center justify-center gap-3 h-[3.4rem] text-[0.88rem]">
            <TriangleAlert className="size-5 text-danger shrink-0" /><span className="truncate"><b className="font-semibold">Erro de reprodução.</b> <span className="text-t3">{error}</span></span>
            <Btn size="sm" icon={<RotateCcw />} onClick={() => usePlayer.getState().toggle()}>Tentar de novo</Btn>
            <Btn size="sm" variant="ghost" onClick={() => { usePlayer.getState().setError(null); usePlayer.getState().next(); }}>Pular</Btn>
            <IconBtn label="Copiar erro" size={30} onClick={() => { copyText(error); toast("Erro copiado"); }}><Copy /></IconBtn>
          </div>
        ) : <><Transport /><Seek /></>}
        {legacy && !error && <div className="absolute -bottom-3.5 inset-x-0 text-center text-t3 text-[0.66rem]">{t.format} · {t.bitrate} · {t.sampleRate}</div>}
      </div>
      {/* extras */}
      <div className="relative flex items-center justify-end gap-0.5 min-w-0">
        <div className="hidden xl:block mr-2"><QualityBadge t={t} /></div>
        {speed !== 1 && <button onClick={() => openDialog("tempo")} className="h-6 px-2 rounded-md bg-accent-soft text-accent text-[0.72rem] font-semibold tnum mr-1">{speed.toFixed(2).replace(".", ",")}×</button>}
        <IconBtn label="Timer de sono" active={!!sleep} size={34} onClick={(e) => openMenuAt(e.currentTarget, sleepMenu())}><Moon /></IconBtn>
        <IconBtn label="Letra (Y)" active={panel === "lyrics"} size={34} onClick={() => togglePanel("lyrics")}><MicVocal /></IconBtn>
        <IconBtn label="Fila (Q)" active={panel === "queue"} size={34} onClick={() => togglePanel("queue")}><ListMusic /></IconBtn>
        <IconBtn label="Detalhes da faixa" active={panel === "details"} size={34} onClick={() => togglePanel("details")} className="hidden lg:grid"><Info /></IconBtn>
        <Volume />
        <IconBtn label="Mais opções" size={34} onClick={(e) => openMenuAt(e.currentTarget, playerMenu(t))}><Ellipsis /></IconBtn>
      </div>
    </footer>
  );
}

export const playerMenu = (t: Track) => [
  { label: "Equalizador", icon: <SlidersHorizontal />, onClick: () => nav("equalizer") },
  { label: "Velocidade e tom…", icon: <Gauge />, onClick: () => openDialog("tempo") },
  { label: "Escolher fonte de áudio", icon: <Waypoints />, onClick: () => openDialog("source", { id: t.id }) },
  { label: "Transmitir para dispositivo…", icon: <Cast />, onClick: () => openDialog("cast") },
  { label: "Mini-player", icon: <PictureInPicture2 />, onClick: () => openDialog("mini") },
  { divider: true },
  ...trackMenu(t),
];

// ───────── Painel lateral: fila, letra, detalhes
export function RightPanel() {
  const panel = useUI((s) => s.panel), setPanel = useUI((s) => s.setPanel);
  const t = useCurrent();
  return (
    <AnimatePresence initial={false}>
      {panel && (
        <motion.aside key="panel" initial={{ width: 0, opacity: 0 }} animate={{ width: 368, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 40 }} className="shrink-0 overflow-hidden border-l border-line bg-s1/60 max-[1100px]:absolute max-[1100px]:right-0 max-[1100px]:inset-y-0 max-[1100px]:z-40 max-[1100px]:bg-s1 max-[1100px]:shadow-2xl">
          <div className="w-[368px] h-full flex flex-col">
            <div className="flex items-center gap-2 h-14 px-4 shrink-0">
              <Segmented id="panel" value={panel} onChange={(v) => setPanel(v)} options={[["queue", "Fila"], ["lyrics", "Letra"], ["details", "Detalhes"]]} />
              <div className="flex-1" />
              {panel === "lyrics" && t && <LyricsMenuButton track={t} />}
              <IconBtn label="Fechar painel" size={32} onClick={() => setPanel(null)}><X /></IconBtn>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={panel} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.14 }} className="flex-1 min-h-0 flex flex-col">
                {!t ? <Empty icon={<ListMusic />} title="Nada tocando" /> : panel === "queue" ? <QueuePanel /> : panel === "lyrics" ? <LyricsView track={t} scale={0.78} className="flex-1 px-5" /> : <DetailsPanel t={t} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function QueueRow({ id, index, current }: { id: string; index: number; current?: boolean }) {
  const t = getTrack(id); const openMenu = useUI((s) => s.openMenu); const playing = usePlayer((s) => s.playing);
  if (!t) return null;
  return (
    <div className={cx("group flex items-center gap-3 h-14 px-2 rounded-lg", current ? "bg-accent-soft" : "hover:bg-s2")} onDoubleClick={() => usePlayer.getState().jump(index)} onContextMenu={(e) => openMenu(e, trackMenu(t, { queueIndex: index }))}>
      {!current && <GripVertical className="size-4 text-t3 opacity-0 group-hover:opacity-100 cursor-grab shrink-0 -mr-1.5" />}
      <button className="relative shrink-0" aria-label="Tocar" onClick={() => (current ? usePlayer.getState().toggle() : usePlayer.getState().jump(index))}>
        <Cover hue={t.hue} seed={t.seed} className="size-10 rounded-md" />
        <span className={cx("absolute inset-0 rounded-md bg-black/55 grid place-items-center", current ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>{current ? <Eq paused={!playing} /> : <Play className="size-4 text-white" fill="currentColor" />}</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx("truncate font-medium text-[0.92rem]", current && "text-accent")}>{t.title}</div>
        <div className="truncate text-t3 text-[0.8rem]">{artistOf(t)}</div>
      </div>
      <span className="text-t3 text-[0.78rem] tnum group-hover:hidden">{fmtTime(t.duration)}</span>
      {!current && <IconBtn label="Remover da fila" size={28} className="hidden group-hover:grid" onClick={() => usePlayer.getState().remove(index)}><X /></IconBtn>}
    </div>
  );
}

export function QueuePanel() {
  const queue = usePlayer((s) => s.queue), index = usePlayer((s) => s.index), title = usePlayer((s) => s.queueTitle), radioOf = usePlayer((s) => s.radioOf);
  const similar = useSetting<boolean>("similarContent");
  const upcoming = queue.slice(index + 1);
  const total = getTracks(upcoming).reduce((s, t) => s + t.duration, 0);
  const [showPast, setShowPast] = useState(false);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-6">
      {index > 0 && (
        <button className="text-t3 hover:text-t1 text-[0.8rem] font-medium px-2 mb-1" onClick={() => setShowPast(!showPast)}>{showPast ? "Esconder" : "Mostrar"} anteriores ({index})</button>
      )}
      {showPast && queue.slice(0, index).map((id, i) => <div key={id + i} className="opacity-60"><QueueRow id={id} index={i} /></div>)}
      <div className="px-2 pt-1 pb-1.5 text-[0.72rem] font-semibold uppercase tracking-wider text-t3">Tocando agora{title && <span className="normal-case tracking-normal font-medium"> · {title}</span>}</div>
      <QueueRow id={queue[index]} index={index} current />
      <div className="flex items-center gap-1 px-2 pt-5 pb-1.5">
        <div className="flex-1 text-[0.72rem] font-semibold uppercase tracking-wider text-t3">A seguir <span className="normal-case tracking-normal font-medium">· {upcoming.length} músicas · {fmtLong(total)}</span></div>
        <IconBtn label="Salvar fila como playlist" size={28} onClick={() => openDialog("createPlaylist", { trackIds: queue })}><ListPlus /></IconBtn>
        <IconBtn label="Limpar a seguir" size={28} disabled={!upcoming.length} onClick={() => usePlayer.getState().clearUpcoming()}><Trash2 /></IconBtn>
      </div>
      {upcoming.length === 0 ? (
        <div className="px-2 py-6 text-t3 text-[0.88rem]">{similar ? "A fila acabou. Músicas parecidas entram sozinhas quando esta terminar." : "A fila acabou."}</div>
      ) : (
        <Reorder.Group axis="y" values={upcoming} onReorder={(ids) => usePlayer.getState().reorder([...queue.slice(0, index + 1), ...ids])}>
          {upcoming.map((id, i) => (
            <Reorder.Item key={id} value={id} whileDrag={{ scale: 1.02, boxShadow: "0 10px 30px #0008", zIndex: 5 }} className="rounded-lg bg-transparent relative">
              <QueueRow id={id} index={index + 1 + i} />
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}
      {radioOf && <div className="mx-2 mt-4 p-3 rounded-xl bg-s2 text-t2 text-[0.84rem]">Rádio baseada em <b className="text-t1 font-semibold">{getTrack(radioOf)?.title}</b>. Novas músicas parecidas entram conforme a fila anda.</div>}
    </div>
  );
}

function DetailsPanel({ t }: { t: Track }) {
  const artist = getArtist(t.artistId)!;
  const followed = useLib((s) => s.followed.includes(t.artistId));
  const provider = useProvider(t)!;
  const next = usePlayer((s) => getTrack(s.queue[s.index + 1]));
  const rows: [string, string][] = [["Fonte", sourceName(provider)], ["Formato", t.format], ["Taxa de bits", t.bitrate], ["Amostragem", t.sampleRate], ["Loudness", "−9,8 LUFS (normalizado para −14)"], ["Reproduções", fmtCount(t.plays)]];
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8">
      <Cover hue={t.hue} seed={t.seed} className="w-full rounded-2xl shadow-xl shadow-black/30" />
      <div className="mt-4 text-[1.25rem] font-semibold leading-tight">{t.title}</div>
      <div className="text-t2">{artistOf(t)}{!t.episode && <span className="text-t3"> · {albumOf(t)}</span>}</div>
      <div className="mt-3"><QualityBadge t={t} /></div>
      {!t.episode && (
        <div className="mt-5 p-4 rounded-2xl bg-s2">
          <div className="flex items-center gap-3">
            <Cover hue={artist.hue} seed={artist.seed} artist className="size-12" />
            <button className="flex-1 min-w-0 text-left" onClick={() => nav(`artist/${artist.id}`)}><div className="font-semibold truncate hover:underline">{artist.name}</div><div className="text-t3 text-[0.82rem]">{fmtCount(artist.listeners)} ouvintes mensais</div></button>
            <Btn size="sm" variant={followed ? "outline" : "soft"} className={followed ? "" : "!bg-s3"} onClick={() => useLib.getState().toggleFollow(artist.id)}>{followed ? "Seguindo" : "Seguir"}</Btn>
          </div>
          <p className="mt-3 text-t2 text-[0.86rem] line-clamp-2">{artist.bio}</p>
        </div>
      )}
      <div className="mt-5 text-[0.72rem] font-semibold uppercase tracking-wider text-t3 mb-2">Áudio</div>
      <div className="rounded-2xl bg-s2 divide-y divide-line">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-4 h-10 items-center text-[0.86rem]"><span className="text-t3">{k}</span><span className="tnum truncate">{v}</span></div>)}
      </div>
      <Btn variant="ghost" size="sm" className="mt-2" icon={<Info />} onClick={() => openDialog("details", { id: t.id })}>Todos os detalhes</Btn>
      {next && (<>
        <div className="mt-5 text-[0.72rem] font-semibold uppercase tracking-wider text-t3 mb-2">A seguir</div>
        <button className="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-s2 hover:bg-s3 text-left transition-colors" onClick={() => usePlayer.getState().next()}>
          <Cover hue={next.hue} seed={next.seed} className="size-11 rounded-lg" /><div className="min-w-0"><div className="truncate font-medium">{next.title}</div><div className="truncate text-t3 text-[0.82rem]">{artistOf(next)}</div></div>
        </button>
      </>)}
    </div>
  );
}

// ───────── Tocando agora (tela cheia)
function Backdrop({ t }: { t: Track }) {
  const mode = useSetting<string>("playerBackground");
  const base = `oklch(0.16 0.04 ${t.hue})`;
  return (
    <div className="absolute inset-0 overflow-hidden transition-colors duration-700" style={{ background: mode === "solid" ? "var(--bg)" : base }}>
      {mode === "gradient" && <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, oklch(0.42 0.13 ${t.hue}), oklch(0.2 0.06 ${(t.hue + 30) % 360}) 55%, oklch(0.12 0.03 ${t.hue}))` }} />}
      {(mode === "blur" || mode === "movingBlur" || mode === "galaxyBlur") && (
        <AnimatePresence>
          <motion.div key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1 }} className="absolute inset-0">
            <div className={cx("absolute -inset-[20%] blur-[90px] saturate-150 opacity-80", mode === "movingBlur" && "drift")} style={{ background: coverBg(t.hue, t.seed) }} />
            {mode === "movingBlur" && <div className="absolute -inset-[30%] blur-[110px] opacity-50 mix-blend-screen drift-rev" style={{ background: coverBg((t.hue + 40) % 360, t.seed + 1) }} />}
          </motion.div>
        </AnimatePresence>
      )}
      {(mode === "galaxy" || mode === "galaxyBlur") && <div className={cx("absolute inset-0 galaxy", mode === "galaxyBlur" && "opacity-60 mix-blend-screen")} style={{ ["--h" as any]: t.hue }} />}
      {mode !== "solid" && <div className="absolute inset-0 bg-black/45" />}
    </div>
  );
}

export function NowPlaying() {
  const open = useUI((s) => s.nowPlaying), setOpen = useUI((s) => s.setNowPlaying), lyricsOnly = useUI((s) => s.lyricsOnly), setLyricsOnly = useUI((s) => s.setLyricsOnly), openMenuAt = useUI((s) => s.openMenuAt);
  const t = useCurrent();
  const title = usePlayer((s) => s.queueTitle), sleep = usePlayer((s) => s.sleep);
  const [side, setSide] = useState<"lyrics" | "queue">("lyrics");
  const align = useSetting<string>("playerTextAlign"), underCover = useSetting<boolean>("lyricsUnderCover"), hideThumb = useSetting<boolean>("hidePlayerThumbnail"), mode = useSetting<string>("playerBackground");
  const dark = mode !== "solid";
  return (
    <AnimatePresence>
      {open && t && (
        <motion.div key="np" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 34, mass: 0.9 }}
          className="fixed inset-0 z-50 flex flex-col" data-theme={dark ? "dark" : undefined} style={dark ? { ["--h" as any]: t.hue, color: "var(--t1)" } : undefined}>
          <Backdrop t={t} />
          {/* topo */}
          <div data-tauri-drag-region className={cx("relative flex items-center gap-3 h-16 px-6 shrink-0", isNativeMac && "pl-24")}>
            <IconBtn label="Fechar (Esc)" onClick={() => setOpen(false)}><ChevronDown className="!size-6" /></IconBtn>
            <div className="flex-1 text-center min-w-0"><div className="text-t3 text-[0.72rem] font-semibold uppercase tracking-widest">Tocando de</div><div className="font-medium truncate">{title || albumOf(t)}</div></div>
            <IconBtn label="Transmitir" onClick={() => openDialog("cast")}><Cast /></IconBtn>
            <IconBtn label="Mais opções" onClick={(e) => openMenuAt(e.currentTarget, playerMenu(t))}><Ellipsis /></IconBtn>
            <WindowControls />
          </div>
          {/* corpo */}
          <div className="relative flex-1 min-h-0 flex items-stretch justify-center gap-[5vw] px-[6vw] pb-2">
            <AnimatePresence initial={false}>
              {!lyricsOnly && (
                <motion.div key="art" initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }} transition={{ type: "spring", stiffness: 260, damping: 32 }} className="flex flex-col justify-center min-w-0 shrink-0">
                  <div className={cx("w-[min(46vh,34vw)]", align === "center" && "text-center")}>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.div key={t.id} initial={{ opacity: 0, scale: 0.9, rotate: -2 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
                        {hideThumb ? <div className="w-full aspect-square rounded-3xl bg-white/8 grid place-items-center"><AudioLines className="size-24 text-accent" /></div>
                          : <motion.div animate={{ scale: 1 }}><Cover hue={t.hue} seed={t.seed} className="w-full rounded-3xl shadow-2xl shadow-black/50" /></motion.div>}
                      </motion.div>
                    </AnimatePresence>
                    {underCover && <LyricLineNow track={t} className="mt-5 h-7 text-[1.05rem] font-semibold text-t2" />}
                    <div className={cx("mt-4 flex items-center gap-3", align === "center" && "justify-center")}>
                      <div className="min-w-0 flex-1">
                        <button className="block max-w-full truncate text-[1.7rem] font-bold tracking-tight hover:underline leading-tight" onClick={() => nav(`album/${t.albumId}`)} onDoubleClick={() => { copyText(t.title); toast("Título copiado"); }}>{t.title}</button>
                        <div className="flex items-center gap-2 text-t2 text-[1.05rem] min-w-0" style={{ justifyContent: align === "center" ? "center" : undefined }}>{t.explicit && <Explicit />}<button className="truncate hover:underline" onClick={() => nav(`artist/${t.artistId}`)}>{artistOf(t)}</button></div>
                      </div>
                      <IconBtn label="Compartilhar" size={42} className="bg-white/8" onClick={() => openDialog("share", { title: t.title, kind: "track", id: t.id })}><Share2 /></IconBtn>
                      <div className="rounded-full bg-white/8"><LikeBtn id={t.id} size={42} /></div>
                    </div>
                    <div className="mt-3"><QualityBadge t={t} /></div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className={cx("flex flex-col min-w-0 min-h-0", lyricsOnly ? "w-[min(60rem,84vw)]" : "w-[min(36rem,40vw)] max-[900px]:hidden")}>
              {!lyricsOnly && (
                <div className="flex items-center gap-2 pt-1 pb-2 shrink-0">
                  <Segmented id="np-side" value={side} onChange={setSide} options={[["lyrics", <><MicVocal />Letra</>], ["queue", <><ListMusic />Fila</>]]} />
                  <div className="flex-1" />
                  {side === "lyrics" && <LyricsMenuButton track={t} size={34} />}
                </div>
              )}
              {side === "lyrics" || lyricsOnly ? <LyricsView track={t} scale={lyricsOnly ? 1.5 : 1.08} className="flex-1" /> : <div className="flex-1 min-h-0 flex flex-col -mx-3"><QueuePanel /></div>}
            </div>
          </div>
          {/* controles */}
          <div className="relative shrink-0 px-[6vw] pb-7 pt-2">
            <div className="max-w-[60rem] mx-auto">
              <Seek times="below" />
              <div className="grid grid-cols-[1fr_auto_1fr] items-center mt-1">
                <div className="flex items-center gap-1">
                  <IconBtn label="Timer de sono" active={!!sleep} size={40} onClick={(e) => openMenuAt(e.currentTarget, sleepMenu())}><Moon /></IconBtn>
                  <IconBtn label="Velocidade e tom" size={40} onClick={() => openDialog("tempo")}><Gauge /></IconBtn>
                  <IconBtn label="Equalizador" size={40} onClick={() => nav("equalizer")}><SlidersHorizontal /></IconBtn>
                </div>
                <Transport big />
                <div className="flex items-center justify-end gap-1">
                  <Volume />
                  <IconBtn label={lyricsOnly ? "Mostrar capa" : "Só a letra"} active={lyricsOnly} size={40} onClick={() => setLyricsOnly(!lyricsOnly)}>{lyricsOnly ? <Minimize2 /> : <Maximize2 />}</IconBtn>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export { Spinner, Badge };
