import { motion } from "motion/react";
import { Pause, Play } from "lucide-react";
import { getTrack, registerTrack } from "../lib/catalog";
import { engine, type RCollection, type RPage, type RSection } from "../lib/engine";
import { cx } from "../lib/util";
import { usePlayer } from "../store/player";
import { nav, toast } from "../store/ui";
import { Shelf, TrackTile } from "./media";
import { Btn, Cover } from "./ui";

const hashHue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/** Registra no catálogo todas as faixas de uma lista de seções e devolve a lista. */
export function registerSections(sections: RSection[]) {
  for (const s of sections) for (const i of s.items) if (i.track) registerTrack(i.track);
  return sections;
}
export function registerPage(p: RPage) {
  p.tracks.forEach((t) => registerTrack(t));
  registerSections(p.sections);
  return p;
}

export const routeOf = (c: RCollection) => `yt/${c.kind}/${encodeURIComponent(c.id)}`;

/** Busca as músicas de um álbum, playlist ou mix e começa a tocar. */
export async function playCollection(c: RCollection, shuffle = false) {
  try {
    const tracks = c.kind === "mix" ? await engine.ytRadio(null, c.id) : (await engine.page(c.id))?.tracks;
    const ids = (tracks ?? []).map((t) => registerTrack(t).id);
    if (!ids.length) return toast("Não há músicas para tocar aqui");
    usePlayer.getState().play(ids, 0, c.title, shuffle ? { shuffle: true } : undefined);
  } catch (e) { toast(`Não foi possível tocar: ${e}`); }
}

/** Cartão de álbum, playlist, artista ou mix vindo do YouTube Music. */
export function RemoteCard({ c }: { c: RCollection }) {
  const h = hashHue(c.id);
  const playingThis = usePlayer((s) => s.playing && s.queueTitle === c.title);
  const playable = c.kind !== "artist";
  return (
    <motion.div whileHover="hover" role="button" tabIndex={0} onClick={() => nav(routeOf(c))} onKeyDown={(e) => e.key === "Enter" && nav(routeOf(c))}
      className="group p-3 -m-1.5 rounded-2xl hover:bg-s1 transition-colors duration-200 text-left">
      <motion.div variants={{ hover: { y: -3 } }} transition={{ type: "spring", stiffness: 400, damping: 26 }} className="relative">
        <Cover hue={h % 360} seed={h % 1e6} src={c.artwork ?? undefined} artist={c.kind === "artist"} className="w-full shadow-lg shadow-black/25" />
        {playable && (
          <button aria-label="Tocar" onClick={(e) => { e.stopPropagation(); playingThis ? usePlayer.getState().toggle() : playCollection(c); }}
            className={cx("absolute right-2.5 bottom-2.5 size-11 rounded-full bg-accent text-accent-fg grid place-items-center shadow-xl shadow-black/40 transition-all duration-200 hover:scale-108 active:scale-95",
              playingThis ? "opacity-100" : "opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0")}>
            {playingThis ? <Pause className="size-5" fill="currentColor" /> : <Play className="size-5 ml-0.5" fill="currentColor" />}
          </button>
        )}
      </motion.div>
      <div className={cx("mt-3 font-medium truncate", c.kind === "artist" && "text-center")}>{c.title}</div>
      <div className={cx("text-t3 text-[0.84rem] truncate", c.kind === "artist" && "text-center")}>{c.subtitle}</div>
    </motion.div>
  );
}

/** Seções (carrosséis de cartões e listas de músicas) do YouTube Music. */
export function RemoteSections({ sections, cardWidth = 172 }: { sections: RSection[]; cardWidth?: number }) {
  return (
    <>
      {sections.map((s, si) => {
        const tracks = s.items.filter((i) => i.track).map((i) => `${i.track!.provider}:${i.track!.id}`);
        if (s.layout === "list" && tracks.length) {
          return (
            <section key={si} className="mb-9">
              <div className="flex items-end gap-3 mb-3.5">
                <div className="flex-1 min-w-0">{s.label && <div className="text-t3 text-[0.8rem] font-medium mb-0.5">{s.label}</div>}<h2 className="text-[1.35rem] font-semibold tracking-tight truncate">{s.title}</h2></div>
                <Btn size="sm" variant="ghost" icon={<Play />} onClick={() => usePlayer.getState().play(tracks, 0, s.title)}>Tocar tudo</Btn>
              </div>
              <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(19rem, 1fr))" }}>
                {tracks.map((id, i) => <TrackTile key={id + i} id={id} ids={tracks} title={s.title} i={i} />)}
              </div>
            </section>
          );
        }
        return (
          <Shelf key={si} title={s.title} sub={s.label ?? undefined} onMore={s.more ? () => nav(`yt/browse/${s.more}`) : undefined}>
            {s.items.map((it, k) => it.collection
              ? <div key={it.collection.kind + it.collection.id + k} style={{ width: cardWidth }} className="shrink-0 snap-start"><RemoteCard c={it.collection} /></div>
              : it.track ? <div key={it.track.id + k} style={{ width: cardWidth }} className="shrink-0 snap-start"><TrackCard id={`${it.track.provider}:${it.track.id}`} ids={tracks} title={s.title} /></div> : null)}
          </Shelf>
        );
      })}
    </>
  );
}

/** Música solta num carrossel: capa quadrada que toca ao clicar. */
function TrackCard({ id, ids, title }: { id: string; ids: string[]; title: string }) {
  const t = getTrack(id);
  const current = usePlayer((s) => s.queue[s.index] === id);
  const playing = usePlayer((s) => s.playing && s.queue[s.index] === id);
  if (!t) return null;
  return (
    <motion.div whileHover="hover" role="button" tabIndex={0} onClick={() => (current ? usePlayer.getState().toggle() : usePlayer.getState().play(ids.length ? ids : [id], Math.max(0, ids.indexOf(id)), title))}
      className="group p-3 -m-1.5 rounded-2xl hover:bg-s1 transition-colors duration-200">
      <motion.div variants={{ hover: { y: -3 } }} className="relative">
        <Cover hue={t.hue} seed={t.seed} src={t.art} className="w-full shadow-lg shadow-black/25" />
        <span className={cx("absolute right-2.5 bottom-2.5 size-11 rounded-full bg-accent text-accent-fg grid place-items-center shadow-xl shadow-black/40 transition-all duration-200", playing ? "opacity-100" : "opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0")}>
          {playing ? <Pause className="size-5" fill="currentColor" /> : <Play className="size-5 ml-0.5" fill="currentColor" />}
        </span>
      </motion.div>
      <div className={cx("mt-3 font-medium truncate", current && "text-accent")}>{t.title}</div>
      <div className="text-t3 text-[0.84rem] truncate">{t.ext?.artists.join(", ")}</div>
    </motion.div>
  );
}

