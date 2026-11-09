import { useEffect, useMemo, useState } from "react";
import { Radio, WifiOff } from "lucide-react";
import { registerTrack } from "../lib/catalog";
import { engine, type RItem, type RSection } from "../lib/engine";
import { registerPage, RemoteCard, RemoteSections } from "../components/remote";
import { TrackList, Grid } from "../components/media";
import { Btn, Cover, Empty, IconBtn, Spinner } from "../components/ui";
import { usePlayer } from "../store/player";
import { Hero, PlayActions } from "./Collection";

interface Data { title: string; subtitle: string; description?: string | null; artwork?: string | null; ids: string[]; sections: RSection[]; items: RItem[] }

const KIND: Record<string, string> = { album: "Álbum", playlist: "Playlist", artist: "Artista", mix: "Mix", browse: "Coleção" };

/** Álbum, playlist, artista ou mix do YouTube Music (rota `yt/<tipo>/<id>`). */
export default function RemoteCollection({ kind, id }: { kind: string; id: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let dead = false;
    setData(null); setError("");
    (async () => {
      try {
        if (kind === "mix") {
          const list = (await engine.ytRadio(null, id)) ?? [];
          if (!dead) setData({ title: "Mix", subtitle: `${list.length} músicas`, ids: list.map((t) => registerTrack(t).id), sections: [], items: [] });
        } else {
          const p = await engine.ytPage(id);
          if (!p || dead) return;
          registerPage(p);
          setData({ title: p.title, subtitle: p.subtitle, description: p.description, artwork: p.artwork, ids: p.tracks.map((t) => `${t.provider}:${t.id}`), sections: p.sections, items: p.items });
        }
      } catch (e) { if (!dead) setError(String(e)); }
    })();
    return () => { dead = true; };
  }, [kind, id, nonce]);

  const gridItems = useMemo(() => (data?.items ?? []).filter((i) => i.collection), [data]);
  if (error) return <Empty icon={<WifiOff />} title="Não foi possível abrir" text={error}><Btn variant="primary" onClick={() => setNonce((n) => n + 1)}>Tentar de novo</Btn></Empty>;
  if (!data) return <div className="grid place-items-center h-80 text-t3"><Spinner className="size-7" /></div>;

  const artist = kind === "artist";
  const first = data.ids[0];
  return (
    <div className="pb-10">
      <Hero hue={id.length * 37 % 360} seed={id.length * 911} round={artist} kind={KIND[kind] ?? "Coleção"} title={data.title || "Sem título"} description={data.description ?? undefined}
        cover={<Cover hue={id.length * 37 % 360} seed={id.length * 911} src={data.artwork ?? undefined} artist={artist} className="w-full" />}
        meta={<span>{data.subtitle}{data.ids.length > 0 && !data.subtitle.includes("músicas") ? ` · ${data.ids.length} músicas` : ""}</span>}>
        <PlayActions ids={data.ids} title={data.title} disabled={!data.ids.length} />
        {first && <IconBtn label="Iniciar rádio" size={44} onClick={() => usePlayer.getState().startRadio(first)}><Radio /></IconBtn>}
      </Hero>
      {data.ids.length > 0 && <div className="px-5"><TrackList ids={data.ids} title={data.title} showAlbum={kind !== "album"} /></div>}
      <div className="px-8 mt-8">
        {gridItems.length > 0 && <div className="mb-9"><Grid>{gridItems.map((i, k) => <RemoteCard key={k} c={i.collection!} />)}</Grid></div>}
        <RemoteSections sections={data.sections} />
        {!data.ids.length && !data.sections.length && !gridItems.length && <Empty icon={<WifiOff />} title="Nada por aqui" text="Esta página não tem músicas para mostrar." />}
      </div>
    </div>
  );
}
