import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Play, WifiOff } from "lucide-react";
import { registerTrack } from "../lib/catalog";
import { engine, type RExplore, type RSection, type RTile } from "../lib/engine";
import { registerSections, RemoteCard, RemoteSections } from "../components/remote";
import { Btn, Chip, Empty, SectionTitle, Spinner } from "../components/ui";
import { usePlayer } from "../store/player";
import { nav, useUI } from "../store/ui";

/** Cada aba do Explorar e a página do YouTube Music que ela mostra. */
const TABS: [string, string, string][] = [
  ["all", "Tudo", "FEmusic_explore"], ["releases", "Lançamentos", "FEmusic_new_releases_albums"], ["charts", "Paradas", "FEmusic_charts"],
  ["moods", "Climas e gêneros", "FEmusic_moods_and_genres"], ["videos", "Videoclipes", "FEmusic_new_releases_videos"],
];
const MOOD = "FEmusic_moods_and_genres_category";
const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: RExplore }>();

function useExplore(browseId: string, params?: string | null) {
  const key = `${browseId}|${params ?? ""}`;
  const [state, setState] = useState<{ data?: RExplore; error?: string }>(() => { const c = cache.get(key); return c && Date.now() - c.at < TTL ? { data: c.data } : {}; });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const c = cache.get(key);
    if (nonce === 0 && c && Date.now() - c.at < TTL) { setState({ data: c.data }); return; }
    let dead = false;
    setState({});
    engine.ytExplore(browseId, params).then((d) => {
      if (!d || dead) return;
      registerSections(d.sections);
      cache.set(key, { at: Date.now(), data: d });
      setState({ data: d });
    }).catch((e) => !dead && setState({ error: String(e) }));
    return () => { dead = true; };
  }, [key, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => { cache.delete(key); setNonce((n) => n + 1); } };
}

const tint = (c?: string | null) => (c ? `linear-gradient(120deg, ${c}, color-mix(in oklch, ${c} 55%, black))` : "linear-gradient(120deg, oklch(0.5 0.12 280), oklch(0.35 0.1 320))");

function TileButton({ t }: { t: RTile }) {
  return (
    <motion.button whileHover={{ y: -2, scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={() => nav(`yt/mood/${encodeURIComponent(t.params ?? "")}/${encodeURIComponent(t.title)}`)}
      className="relative h-20 rounded-xl overflow-hidden text-left px-4 flex items-center font-semibold text-white text-[1.02rem] shadow-md shadow-black/20" style={{ background: tint(t.color) }}>
      <span className="relative drop-shadow">{t.title}</span>
    </motion.button>
  );
}

function Tiles({ tiles }: { tiles: RTile[] }) {
  return <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(12.5rem, 1fr))" }}>{tiles.filter((t) => t.browseId === MOOD).map((t) => <TileButton key={t.title + t.params} t={t} />)}</div>;
}

/** Videoclipes e outras músicas soltas numa grade: toca ao clicar. */
function VideoGrid({ section }: { section: RSection }) {
  const ids = section.items.filter((i) => i.track).map((i) => registerTrack(i.track!).id);
  let k = -1;
  return (
    <div className="grid gap-x-4 gap-y-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))" }}>
      {section.items.map((it, n) => {
        if (it.collection) return <RemoteCard key={n} c={it.collection} />;
        if (!it.track) return null;
        const idx = ++k, t = it.track;
        return (
          <button key={n} className="group text-left" onClick={() => usePlayer.getState().play(ids, idx, section.title || "Videoclipes")}>
            <div className="relative aspect-video rounded-xl overflow-hidden bg-s2">
              {t.artworkUrl && <img src={t.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
              <span className="absolute inset-0 bg-black/30 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"><Play className="size-9 text-white" fill="currentColor" /></span>
            </div>
            <div className="mt-2 font-medium truncate">{t.title}</div><div className="text-t3 text-[0.84rem] truncate">{t.artists.join(", ")}</div>
          </button>
        );
      })}
    </div>
  );
}

function Body({ data, tab }: { data: RExplore; tab: string }) {
  const grids = data.sections.filter((s) => s.layout === "grid");
  const rest = data.sections.filter((s) => s.layout !== "grid");
  const moodGroups = data.groups.filter((g) => g.tiles.some((t) => t.browseId === MOOD));
  return (
    <>
      {grids.map((s, i) => <div key={i}>{s.title && <SectionTitle>{s.title}</SectionTitle>}<VideoGrid section={s} /></div>)}
      {tab === "moods"
        ? moodGroups.map((g) => <section key={g.title} className="mb-8"><SectionTitle>{g.title}</SectionTitle><Tiles tiles={g.tiles} /></section>)
        : <RemoteSections sections={rest} />}
      {tab === "all" && moodGroups.slice(0, 1).map((g) => <section key={g.title} className="mb-9"><SectionTitle action={<button className="text-t3 hover:text-t1 text-[0.84rem] font-medium" onClick={() => useUI.getState().replace("explore/moods")}>Ver todos</button>}>Climas e gêneros</SectionTitle><Tiles tiles={g.tiles.slice(0, 12)} /></section>)}
    </>
  );
}

function Loading() { return <div className="grid place-items-center h-64 text-t3"><Spinner className="size-7" /></div>; }
function Failed({ error, retry }: { error: string; retry: () => void }) { return <Empty icon={<WifiOff />} title="Não foi possível carregar" text={error}><Btn variant="primary" onClick={retry}>Tentar de novo</Btn></Empty>; }

/** Aba Explorar com o conteúdo real do YouTube Music. */
export default function YtExplore({ tab = "all" }: { tab?: string }) {
  const cur = TABS.find((t) => t[0] === tab) ?? TABS[0];
  const { data, error, retry } = useExplore(cur[2]);
  const set = (t: string) => useUI.getState().replace(t === "all" ? "explore" : `explore/${t}`);
  return (
    <div className="px-8 pt-5 pb-10">
      <h1 className="text-[2.1rem] font-bold tracking-tight mb-4">Explorar</h1>
      <div className="flex gap-2 mb-7 flex-wrap">{TABS.map(([v, l]) => <Chip key={v} active={cur[0] === v} onClick={() => set(v)}>{l}</Chip>)}</div>
      {error ? <Failed error={error} retry={retry} /> : !data ? <Loading /> : <Body data={data} tab={cur[0]} />}
    </div>
  );
}

/** Página de um clima ou gênero (rota `yt/mood/<params>/<título>`). */
export function YtMood({ params, title }: { params: string; title: string }) {
  const { data, error, retry } = useExplore(MOOD, params);
  return (
    <div className="pb-10">
      <div className="px-8 pt-10 pb-6"><div className="text-[0.76rem] font-semibold uppercase tracking-widest text-t2">Clima e gênero</div><h1 className="text-[3rem] font-bold tracking-tight leading-none mt-1">{title}</h1></div>
      <div className="px-8">{error ? <Failed error={error} retry={retry} /> : !data ? <Loading /> : <Body data={data} tab="mood" />}</div>
    </div>
  );
}

