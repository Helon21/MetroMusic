import { useEffect, useState } from "react";
import { LogIn, RefreshCw, WifiOff } from "lucide-react";
import { SourceIcon } from "../lib/brands";
import { engine, type RSection } from "../lib/engine";
import { sourceName, type SourceId } from "../lib/catalog";
import { useSp } from "../lib/spotify";
import { registerSections, RemoteSections } from "../components/remote";
import { Btn, Empty, IconBtn, Spinner } from "../components/ui";
import { openDialog } from "../store/ui";

/** Fontes com início real no backend. As outras (TIDAL, Qobuz, JioSaavn, Offline) ainda não têm backend. */
const REAL: SourceId[] = ["soundcloud", "deezer", "spotify"];
const cache = new Map<string, { at: number; sections: RSection[] }>();
const TTL = 5 * 60 * 1000;

export default function RemoteHome({ source }: { source: SourceId }) {
  const spUser = useSp((s) => s.info?.name);
  const spEpoch = useSp((s) => s.epoch);
  const needsLogin = source === "spotify" && !spUser;
  const key = `${source}:${spEpoch}`;
  const [sections, setSections] = useState<RSection[] | null>(() => { const c = cache.get(key); return c && Date.now() - c.at < TTL ? c.sections : null; });
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!REAL.includes(source) || needsLogin) return;
    const hit = nonce === 0 ? cache.get(key) : undefined;
    if (hit && Date.now() - hit.at < TTL) { setSections(hit.sections); return; }
    let dead = false;
    setSections(null); setError("");
    engine.otherHome(source).then((s) => { if (dead || !s) return; registerSections(s); cache.set(key, { at: Date.now(), sections: s }); setSections(s); }).catch((e) => !dead && setError(String(e)));
    return () => { dead = true; };
  }, [source, needsLogin, key, nonce]);

  const header = (
    <div className="flex items-end gap-4 mb-6">
      <div className="flex-1 min-w-0">
        <div className="text-t3 font-medium flex items-center gap-2"><SourceIcon id={source} size={16} />{sourceName(source)}</div>
        <h1 className="text-[2.1rem] font-bold tracking-tight leading-tight truncate">{source === "spotify" && spUser ? `Olá, ${spUser}` : "Início"}</h1>
      </div>
      {REAL.includes(source) && !needsLogin && <IconBtn label="Atualizar" onClick={() => { cache.delete(key); setNonce((n) => n + 1); }}><RefreshCw className={!sections && !error ? "animate-spin" : ""} /></IconBtn>}
    </div>
  );

  let body;
  if (!REAL.includes(source)) body = <Empty icon={<WifiOff />} title={`${sourceName(source)} ainda não tem backend`} text="Esta fonte ainda não foi ligada ao serviço real. Use o YouTube Music, o SoundCloud, o Deezer ou o Spotify." />;
  else if (needsLogin) body = <Empty icon={<LogIn />} title="Entre no Spotify" text="Entre com a sua conta para ver o que você ouviu, suas playlists e álbuns salvos, e sincronizar as curtidas."><Btn variant="primary" icon={<LogIn />} onClick={() => openDialog("login", { service: "spotify" })}>Entrar no Spotify</Btn></Empty>;
  else if (error) body = <Empty icon={<WifiOff />} title="Não foi possível carregar" text={error}><Btn variant="primary" onClick={() => setNonce((n) => n + 1)}>Tentar de novo</Btn></Empty>;
  else if (!sections) body = <div className="grid place-items-center h-64 text-t3"><Spinner className="size-7" /></div>;
  else body = <RemoteSections sections={sections} />;
  return <div className="px-8 pt-3 pb-10">{header}{body}</div>;
}
