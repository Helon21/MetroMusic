import { memo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, Clock3, Ellipsis, Heart, Pause, Play, Video } from "lucide-react";
import { albumOf, artistOf, getAlbum, getArtist, getPodcast, getTrack, getTracks, type Track } from "../lib/catalog";
import { albumMenu, artistMenu, playlistMenu, trackMenu, tracksMenu, type TrackCtx } from "../lib/menus";
import { cx, fmtCount, fmtTime } from "../lib/util";
import { resolvePlaylist, useLib, type Pin } from "../store/library";
import { usePlayer } from "../store/player";
import { useSetting } from "../store/settings";
import { nav, useUI } from "../store/ui";
import { Cover, Eq, Explicit, IconBtn, SectionTitle, Spinner } from "./ui";

// ───────── Lista de faixas
interface ListProps {
  ids: string[]; title?: string; ctx?: TrackCtx; numbered?: boolean; showAlbum?: boolean; showCover?: boolean; showPlays?: boolean;
  header?: boolean; onReorder?: (ids: string[]) => void; dateOf?: (id: string, i: number) => string | undefined; dense?: boolean; ctxOf?: (id: string, i: number) => TrackCtx;
}

export function TrackList({ ids: rawIds, title = "", ctx = {}, numbered, showAlbum = true, showCover = true, showPlays, header = true, onReorder, dateOf, dense, ctxOf }: ListProps) {
  const hideExplicit = useSetting<boolean>("hideExplicit");
  const hideVideo = useSetting<boolean>("hideVideoSongs");
  const ids = hideExplicit || hideVideo ? rawIds.filter((i) => { const t = getTrack(i); return !(hideExplicit && t?.explicit) && !(hideVideo && t?.video); }) : rawIds;
  const sel = useUI((s) => s.sel), setSel = useUI((s) => s.setSel), openMenu = useUI((s) => s.openMenu);
  const anchor = useRef<number>(-1);
  const [drop, setDrop] = useState<number | null>(null);
  const cols = cx("grid items-center gap-3 px-3", showAlbum ? (showPlays ? "grid-cols-[2rem_minmax(0,5fr)_minmax(0,3fr)_5.5rem_2rem_3.2rem_2rem]" : "grid-cols-[2rem_minmax(0,5fr)_minmax(0,3fr)_2rem_3.2rem_2rem]") : showPlays ? "grid-cols-[2rem_minmax(0,1fr)_5.5rem_2rem_3.2rem_2rem]" : "grid-cols-[2rem_minmax(0,1fr)_2rem_3.2rem_2rem]");

  const click = (e: React.MouseEvent, id: string, i: number) => {
    if (e.shiftKey && anchor.current >= 0) { const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]; setSel(ids.slice(a, b + 1)); }
    else if (e.ctrlKey || e.metaKey) { setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]); anchor.current = i; }
    else { setSel([id]); anchor.current = i; }
  };
  const play = (i: number) => usePlayer.getState().play(ids, i, title);
  const menu = (e: React.MouseEvent, t: Track, i: number) => {
    if (sel.length > 1 && sel.includes(t.id)) return openMenu(e, tracksMenu(sel, ctx));
    setSel([t.id]); anchor.current = i; openMenu(e, trackMenu(t, ctxOf ? ctxOf(t.id, i) : ctx));
  };
  const dragStart = (e: React.DragEvent, id: string) => {
    const drag = sel.includes(id) ? sel : [id];
    e.dataTransfer.setData("application/x-tracks", JSON.stringify(drag));
    e.dataTransfer.setData("text/plain", drag.map((d) => getTrack(d)?.title).join(", "));
    e.dataTransfer.effectAllowed = "copyMove";
    const ghost = document.createElement("div");
    ghost.textContent = drag.length > 1 ? `${drag.length} músicas` : (getTrack(id)?.title ?? "");
    ghost.style.cssText = "position:fixed;top:-100px;padding:6px 12px;border-radius:99px;background:var(--accent);color:var(--accent-fg);font:600 13px 'Geist Variable'";
    document.body.appendChild(ghost); e.dataTransfer.setDragImage(ghost, 0, 0); setTimeout(() => ghost.remove());
  };
  const onDrop = (e: React.DragEvent) => {
    if (!onReorder || drop === null) return;
    e.preventDefault();
    const moved: string[] = JSON.parse(e.dataTransfer.getData("application/x-tracks") || "[]");
    const before = ids[drop];
    const rest = ids.filter((i) => !moved.includes(i));
    const at = before && !moved.includes(before) ? rest.indexOf(before) : rest.length;
    onReorder([...rest.slice(0, at), ...moved.filter((m) => ids.includes(m)), ...rest.slice(at)]);
    setDrop(null);
  };

  return (
    <div role="grid" onDrop={onDrop} onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}>
      {header && (
        <div className={cx(cols, "h-9 text-t3 text-[0.76rem] font-medium uppercase tracking-wider border-b border-line mb-1.5")}>
          <span className="text-center">#</span><span>Título</span>{showAlbum && <span>Álbum</span>}{showPlays && <span className="text-right">Reproduções</span>}<span /><span className="flex justify-end pr-0.5"><Clock3 className="size-4" /></span><span />
        </div>
      )}
      {ids.map((id, i) => (
        <div key={id + i} onDragOver={onReorder ? (e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrop(e.clientY < r.top + r.height / 2 ? i : i + 1); } : undefined} className="relative">
          {drop === i && <div className="absolute -top-px inset-x-2 h-0.5 bg-accent rounded-full z-10" />}
          {drop === ids.length && i === ids.length - 1 && <div className="absolute -bottom-px inset-x-2 h-0.5 bg-accent rounded-full z-10" />}
          <Row id={id} i={i} cols={cols} selected={sel.includes(id)} numbered={numbered} showAlbum={showAlbum} showCover={showCover} showPlays={showPlays} dense={dense} date={dateOf?.(id, i)}
            onClick={click} onPlay={play} onMenu={menu} onDragStart={dragStart} />
        </div>
      ))}
    </div>
  );
}

const Row = memo(function Row({ id, i, cols, selected, numbered, showAlbum, showCover, showPlays, dense, date, onClick, onPlay, onMenu, onDragStart }: {
  id: string; i: number; cols: string; selected: boolean; numbered?: boolean; showAlbum: boolean; showCover: boolean; showPlays?: boolean; dense?: boolean; date?: string;
  onClick: (e: React.MouseEvent, id: string, i: number) => void; onPlay: (i: number) => void; onMenu: (e: React.MouseEvent, t: Track, i: number) => void; onDragStart: (e: React.DragEvent, id: string) => void;
}) {
  const t = getTrack(id)!;
  const current = usePlayer((s) => s.queue[s.index] === id);
  const playing = usePlayer((s) => s.playing && s.queue[s.index] === id);
  const liked = useLib((s) => s.liked.includes(id));
  const dl = useLib((s) => s.downloads[id]);
  const online = useUI((s) => s.online);
  if (!t) return null;
  const unavailable = !online && !(dl >= 1);
  return (
    <div role="row" aria-selected={selected} draggable onDragStart={(e) => onDragStart(e, id)} onClick={(e) => onClick(e, id, i)} onDoubleClick={() => !unavailable && onPlay(i)} onContextMenu={(e) => onMenu(e, t, i)}
      className={cx(cols, "group rounded-lg transition-colors duration-100", dense ? "h-12" : "h-14", selected ? "bg-accent-soft" : "hover:bg-s2", unavailable && "opacity-40")}>
      <div className="relative grid place-items-center text-t3 tnum text-[0.88rem]">
        <span className={cx("group-hover:opacity-0", current && "opacity-0")}>{numbered || !showCover ? i + 1 : i + 1}</span>
        {current && <Eq paused={!playing} className="absolute group-hover:opacity-0" />}
        <button aria-label={playing ? "Pausar" : "Tocar"} onClick={(e) => { e.stopPropagation(); current ? usePlayer.getState().toggle() : onPlay(i); }} className="absolute opacity-0 group-hover:opacity-100 text-t1">
          {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4" fill="currentColor" />}
        </button>
      </div>
      <div className="flex items-center gap-3 min-w-0">
        {showCover && <Cover hue={t.hue} seed={t.seed} className={dense ? "size-9 rounded-md" : "size-10 rounded-md"} />}
        <div className="min-w-0">
          <div className={cx("truncate font-medium flex items-center gap-1.5", current && "text-accent")}><span className="truncate">{t.title}</span>{t.video && <Video className="size-3.5 text-t3 shrink-0" />}</div>
          <div className="truncate text-t3 text-[0.84rem] flex items-center gap-1.5">
            {t.explicit && <Explicit />}
            {dl >= 1 && <ArrowDownToLine className="size-3.5 text-ok shrink-0" />}
            {dl > 0 && dl < 1 && <span className="text-accent tnum text-[0.75rem] inline-flex items-center gap-1"><Spinner className="size-3" />{Math.round(dl * 100)}%</span>}
            <button className="truncate hover:underline hover:text-t1" onClick={(e) => { e.stopPropagation(); nav(t.episode ? `podcast/${t.podcastId}` : `artist/${t.artistId}`); }}>{artistOf(t)}</button>
            {date && <span className="shrink-0">· {date}</span>}
          </div>
        </div>
      </div>
      {showAlbum && <button className="truncate text-left text-t3 text-[0.88rem] hover:underline hover:text-t1" onClick={(e) => { e.stopPropagation(); nav(t.episode ? `podcast/${t.podcastId}` : `album/${t.albumId}`); }}>{albumOf(t)}</button>}
      {showPlays && <span className="text-right text-t3 text-[0.86rem] tnum">{fmtCount(t.plays)}</span>}
      <button aria-label={liked ? "Remover curtida" : "Curtir"} onClick={(e) => { e.stopPropagation(); useLib.getState().toggleLike(id); }} className={cx("grid place-items-center transition-[opacity,transform] active:scale-75", liked ? "text-accent" : "text-t3 opacity-0 group-hover:opacity-100 hover:text-t1")}>
        <Heart className="size-4" fill={liked ? "currentColor" : "none"} />
      </button>
      <span className="text-right text-t3 text-[0.86rem] tnum pr-0.5">{fmtTime(t.duration)}</span>
      <button aria-label="Mais opções" onClick={(e) => { e.stopPropagation(); onMenu(e, t, i); }} className="grid place-items-center text-t3 opacity-0 group-hover:opacity-100 hover:text-t1"><Ellipsis className="size-4.5" /></button>
    </div>
  );
});

// ───────── Cartões
export interface Item { type: Pin["type"] | "podcast" | "mood"; id: string }
export function resolveItem(it: Item, lib = useLib.getState()) {
  switch (it.type) {
    case "album": { const a = getAlbum(it.id); return a && { title: a.title, sub: `${a.kind} · ${getArtist(a.artistId)?.name}`, hue: a.hue, seed: a.seed, to: `album/${a.id}`, ids: a.trackIds, menu: () => albumMenu(a) }; }
    case "artist": { const a = getArtist(it.id); return a && { title: a.name, sub: "Artista", hue: a.hue, seed: a.seed, to: `artist/${a.id}`, artist: true, ids: getTracks([]).map((t) => t.id), menu: () => artistMenu(a) }; }
    case "playlist": { const p = resolvePlaylist(it.id, lib); return p && { title: p.title, sub: p.kind === "auto" ? `${p.trackIds.length} músicas` : p.kind === "mix" ? "Mix" : `Playlist · ${p.owner}`, hue: p.hue, seed: p.seed, to: `playlist/${p.id}`, icon: p.icon, ids: p.trackIds, menu: () => playlistMenu(p) }; }
    case "podcast": { const p = getPodcast(it.id); return p && { title: p.title, sub: `Podcast · ${p.author}`, hue: p.hue, seed: p.seed, to: `podcast/${p.id}`, ids: p.episodeIds, menu: () => [] }; }
    case "track": { const t = getTrack(it.id); return t && { title: t.title, sub: `Música · ${artistOf(t)}`, hue: t.hue, seed: t.seed, to: "", ids: [t.id], menu: () => trackMenu(t) }; }
  }
  return undefined;
}

export const MediaCard = memo(function MediaCard({ item, sub, className }: { item: Item; sub?: string; className?: string }) {
  useLib((s) => s.playlists);
  const r = resolveItem(item);
  const openMenu = useUI((s) => s.openMenu);
  const playingThis = usePlayer((s) => s.playing && !!r && s.queueTitle === r.title);
  if (!r) return null;
  const play = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playingThis) return usePlayer.getState().toggle();
    if (item.type === "artist") return nav(r.to);
    usePlayer.getState().play(r.ids, 0, r.title);
  };
  return (
    <motion.div whileHover="hover" className={cx("group p-3 -m-1.5 rounded-2xl hover:bg-s1 transition-colors duration-200 text-left", className)}
      onClick={() => (r.to ? nav(r.to) : play())} onContextMenu={(e) => { const m = r.menu(); if (m.length) openMenu(e, m); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && (r.to ? nav(r.to) : play())}>
      <motion.div variants={{ hover: { y: -3 } }} transition={{ type: "spring", stiffness: 400, damping: 26 }} className="relative">
        <Cover hue={r.hue} seed={r.seed} artist={(r as any).artist} icon={(r as any).icon} className="w-full shadow-lg shadow-black/25" />
        {item.type !== "artist" && r.ids.length > 0 && (
          <button aria-label="Tocar" onClick={play} className={cx("absolute right-2.5 bottom-2.5 size-11 rounded-full bg-accent text-accent-fg grid place-items-center shadow-xl shadow-black/40 transition-all duration-200 hover:scale-108 active:scale-95",
            playingThis ? "opacity-100" : "opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0")}>
            {playingThis ? <Pause className="size-5" fill="currentColor" /> : <Play className="size-5 ml-0.5" fill="currentColor" />}
          </button>
        )}
      </motion.div>
      <div className={cx("mt-3 font-medium truncate", item.type === "artist" && "text-center")}>{r.title}</div>
      <div className={cx("text-t3 text-[0.84rem] truncate", item.type === "artist" && "text-center")}>{sub ?? r.sub}</div>
    </motion.div>
  );
});

const CARD = { small: 148, medium: 172, big: 204 } as const;
export function useCardWidth() { return CARD[useSetting<keyof typeof CARD>("gridSize")] ?? 172; }

export function Grid({ children, min }: { children: ReactNode; min?: number }) {
  const w = useCardWidth();
  return <div className="grid gap-x-3 gap-y-5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min ?? w}px, 1fr))` }}>{children}</div>;
}

/** Prateleira horizontal com setas; os filhos definem a própria largura. */
export function Shelf({ title, sub, children, onMore, action }: { title: string; sub?: ReactNode; children: ReactNode; onMore?: () => void; action?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section className="mb-9">
      <SectionTitle sub={sub} action={<div className="flex items-center gap-1">
        {action}
        {onMore && <button onClick={onMore} className="text-t3 hover:text-t1 text-[0.84rem] font-medium px-2 mr-1">Ver tudo</button>}
        <IconBtn label="Anterior" size={30} onClick={() => scroll(-1)}><ChevronLeft /></IconBtn><IconBtn label="Próximo" size={30} onClick={() => scroll(1)}><ChevronRight /></IconBtn>
      </div>}>{title}</SectionTitle>
      <div ref={ref} className="flex gap-3 overflow-x-auto no-scrollbar scroll-smooth -mx-8 px-8 py-1.5 snap-x">{children}</div>
    </section>
  );
}
export function ShelfCards({ items, ...p }: { items: Item[]; title: string; sub?: ReactNode; onMore?: () => void }) {
  const w = useCardWidth();
  return <Shelf {...p}>{items.map((it) => <div key={it.type + it.id} style={{ width: w }} className="shrink-0 snap-start"><MediaCard item={it} /></div>)}</Shelf>;
}

/** Linha compacta de faixa para grades (sugestões rápidas, resultados). */
export function TrackTile({ id, ids, title, i }: { id: string; ids: string[]; title: string; i: number }) {
  const t = getTrack(id)!;
  const current = usePlayer((s) => s.queue[s.index] === id);
  const playing = usePlayer((s) => s.playing && s.queue[s.index] === id);
  const openMenu = useUI((s) => s.openMenu);
  return (
    <div className="group flex items-center gap-3 p-2 rounded-xl hover:bg-s2 transition-colors min-w-0" onDoubleClick={() => usePlayer.getState().play(ids, i, title)} onContextMenu={(e) => openMenu(e, trackMenu(t))}>
      <button aria-label="Tocar" className="relative shrink-0" onClick={() => (current ? usePlayer.getState().toggle() : usePlayer.getState().play(ids, i, title))}>
        <Cover hue={t.hue} seed={t.seed} className="size-12 rounded-lg" />
        <span className={cx("absolute inset-0 grid place-items-center rounded-lg bg-black/50 transition-opacity", current ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          {current && playing ? <Eq /> : <Play className="size-4.5 text-white" fill="currentColor" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx("truncate font-medium", current && "text-accent")}>{t.title}</div>
        <div className="truncate text-t3 text-[0.84rem] flex items-center gap-1.5">{t.explicit && <Explicit />}{artistOf(t)}</div>
      </div>
      <IconBtn label="Mais opções" size={30} className="opacity-0 group-hover:opacity-100" onClick={(e) => openMenu(e, trackMenu(t))}><Ellipsis /></IconBtn>
    </div>
  );
}
