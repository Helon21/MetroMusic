import { useEffect, useState } from "react";
import { Music, Play, WifiOff } from "lucide-react";
import { registerTrack } from "../lib/catalog";
import { useYt } from "../lib/account";
import { useSc } from "../lib/soundcloud";
import { useSp } from "../lib/spotify";
import { engine, type RPage } from "../lib/engine";
import { Grid, TrackList } from "../components/media";
import { RemoteCard } from "../components/remote";
import { Btn, Empty, Spinner } from "../components/ui";
import { usePlayer } from "../store/player";

export type YtKind = "songs" | "playlists" | "albums" | "artists" | "history";
const cache = new Map<string, RPage>();
const idOf = (t: { provider: string; id: string }) => `${t.provider}:${t.id}`;

/** Biblioteca ou histórico REAIS da conta do YouTube Music. */
export default function YtLibraryView({ kind, filter = "", provider = "youtube" }: { kind: YtKind; filter?: string; provider?: "youtube" | "soundcloud" | "spotify" }) {
  const ytEpoch = useYt((s) => s.epoch), scEpoch = useSc((s) => s.epoch), spEpoch = useSp((s) => s.epoch);
  const epoch = provider === "soundcloud" ? scEpoch : provider === "spotify" ? spEpoch : ytEpoch;
  const key = `${provider}:${epoch}:${kind}`;
  const [page, setPage] = useState<RPage | null>(cache.get(key) ?? null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let dead = false;
    const hit = nonce === 0 ? cache.get(key) : undefined;
    if (hit) { setPage(hit); return; }
    setPage(null); setError("");
    (provider === "soundcloud" ? engine.scLibrary(kind as "songs" | "playlists" | "history") : provider === "spotify" ? engine.spLibrary(kind) : engine.ytLibrary(kind)).then((p) => {
      if (!p || dead) return;
      p.tracks.forEach((t) => registerTrack(t));
      p.sections.forEach((s) => s.items.forEach((i) => i.track && registerTrack(i.track)));
      cache.set(key, p); setPage(p);
    }).catch((e) => !dead && setError(String(e)));
    return () => { dead = true; };
  }, [key, kind, provider, nonce]);

  if (error) return <Empty icon={<WifiOff />} title="Não foi possível carregar" text={error}><Btn variant="primary" onClick={() => { cache.delete(key); setNonce((n) => n + 1); }}>Tentar de novo</Btn></Empty>;
  if (!page) return <div className="grid place-items-center h-48 text-t3"><Spinner className="size-7" /></div>;
  const q = filter.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);

  if (kind === "songs") {
    const ids = page.tracks.filter((t) => match(`${t.title} ${t.artists.join(" ")}`)).map(idOf);
    if (!ids.length) return <Empty icon={<Music />} title={q ? "Nenhum resultado encontrado" : "Nenhuma música curtida na conta"} />;
    return <><div className="mb-3"><Btn size="sm" icon={<Play />} onClick={() => usePlayer.getState().play(ids, 0, "Curtidas da conta")}>Tocar tudo</Btn></div><TrackList ids={ids} title="Curtidas da conta" /></>;
  }
  if (kind === "history") {
    const secs = page.sections.map((s) => ({ ...s, ids: s.items.filter((i) => i.track && match(`${i.track.title} ${i.track.artists.join(" ")}`)).map((i) => idOf(i.track!)) })).filter((s) => s.ids.length);
    if (!secs.length) return <Empty icon={<Music />} title={q ? "Nenhum resultado encontrado" : "Nada no histórico da conta"} text={q ? undefined : "As músicas que você ouvir no YouTube Music aparecem aqui."} />;
    return <>{secs.map((s, i) => (
      <section key={i} className="mb-7 -mx-3">
        <div className="px-3 flex items-center gap-3 mb-1"><h2 className="text-[1.15rem] font-semibold flex-1">{s.title || "Recentes"}</h2><Btn size="sm" variant="ghost" icon={<Play />} onClick={() => usePlayer.getState().play(s.ids, 0, `Histórico: ${s.title}`)}>Tocar</Btn></div>
        <TrackList ids={s.ids} title={`Histórico: ${s.title}`} header={false} dense />
      </section>
    ))}</>;
  }
  const items = page.items.filter((i) => i.collection && match(`${i.collection.title} ${i.collection.subtitle}`));
  if (!items.length) return <Empty icon={<Music />} title={q ? "Nenhum resultado encontrado" : "Nada por aqui ainda"} text={q ? undefined : "O que você salvar no YouTube Music aparece aqui."} />;
  return <Grid>{items.map((i, k) => <RemoteCard key={k} c={i.collection!} />)}</Grid>;
}
