import { useCallback, useEffect, useRef, useState } from "react";
import { LogIn, RefreshCw, WifiOff } from "lucide-react";
import { SourceIcon } from "../lib/brands";
import { engine, type RChip, type RSection } from "../lib/engine";
import { registerSections, RemoteSections } from "../components/remote";
import { Btn, Chip, Empty, IconBtn } from "../components/ui";
import { useLib } from "../store/library";
import { openDialog } from "../store/ui";
import { useYt } from "../lib/account";

const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };

interface Cached { sections: RSection[]; chips: RChip[]; cont: string | null; personalized: boolean; at: number }
/** Guarda a Início por 5 minutos para voltar a ela sem esperar de novo. */
const cache = new Map<string, Cached>();
const TTL = 5 * 60 * 1000;
const keyOf = (c: RChip | null) => (c ? `${c.browseId}|${c.params ?? ""}` : "home");

function Skeleton() {
  return (
    <div>
      <div className="flex gap-2 mb-7">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-8 w-20 rounded-full" />)}</div>
      {[0, 1].map((r) => (
        <div key={r} className="mb-9"><div className="skeleton h-7 w-56 mb-4" />
          <div className="flex gap-4">{Array.from({ length: 6 }, (_, i) => <div key={i} className="shrink-0 w-44"><div className="skeleton aspect-square mb-3" /><div className="skeleton h-4 w-32 mb-2" /><div className="skeleton h-3 w-20" /></div>)}</div></div>
      ))}
    </div>
  );
}

/** Início do YouTube Music com o conteúdo real (da conta, se houver sessão). */
export default function YtHome() {
  const account = useYt((s) => s.info?.name) ?? useLib((s) => s.accounts.youtube);
  const epoch = useYt((s) => s.epoch);
  const [chip, setChip] = useState<RChip | null>(null);
  const [data, setData] = useState<Cached | null>(() => { const c = cache.get("home"); return c && Date.now() - c.at < TTL ? c : null; });
  const [state, setState] = useState<"loading" | "ok" | "error">(data ? "ok" : "loading");
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (c: RChip | null, force = false) => {
    const k = keyOf(c);
    const hit = cache.get(k);
    if (!force && hit && Date.now() - hit.at < TTL) { setData(hit); setState("ok"); return; }
    setState("loading");
    try {
      const feed = await engine.ytHome(c);
      if (!feed || !alive.current) return;
      registerSections(feed.sections);
      const d: Cached = { sections: feed.sections, chips: feed.chips.length ? feed.chips : (cache.get("home")?.chips ?? []), cont: feed.continuation ?? null, personalized: feed.personalized, at: Date.now() };
      cache.set(k, d);
      setData(d); setState("ok");
    } catch (e) { if (alive.current) { setError(String(e)); setState("error"); } }
  }, []);

  useEffect(() => { if (!data) load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // entrou ou saiu da conta: a Início é outra
  const firstEpoch = useRef(epoch);
  useEffect(() => { if (epoch === firstEpoch.current) return; cache.clear(); setChip(null); setData(null); load(null, true); }, [epoch]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!data?.cont || more) return;
    setMore(true);
    try {
      const feed = await engine.ytHome(chip, data.cont);
      if (!feed || !alive.current) return;
      registerSections(feed.sections);
      const next: Cached = { ...data, sections: [...data.sections, ...feed.sections], cont: feed.continuation ?? null, at: data.at };
      cache.set(keyOf(chip), next);
      setData(next);
    } catch { /* a próxima rolagem tenta de novo */ }
    finally { if (alive.current) setMore(false); }
  }, [data, chip, more]);

  // Carrega a próxima parte ao chegar perto do fim da página.
  useEffect(() => {
    const el = sentinel.current; if (!el || !data?.cont) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { root: document.getElementById("main-scroll"), rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [data?.cont, loadMore]);

  const chips = data?.chips ?? cache.get("home")?.chips ?? [];
  const pick = (c: RChip | null) => { setChip(c); load(c); };

  return (
    <div className="px-8 pt-3 pb-10">
      <div className="flex items-end gap-4 mb-5">
        <div className="flex-1 min-w-0">
          <div className="text-t3 font-medium flex items-center gap-2"><SourceIcon id="youtube" size={16} />YouTube Music</div>
          <h1 className="text-[2.1rem] font-bold tracking-tight leading-tight truncate">{greeting()}{account ? `, ${account}` : ""}</h1>
        </div>
        <IconBtn label="Atualizar" onClick={() => { cache.clear(); load(chip, true); }}><RefreshCw className={state === "loading" ? "animate-spin" : ""} /></IconBtn>
      </div>

      {chips.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-8 px-8 mb-7">
          {chip ? <Chip active onClick={() => pick(null)} onClose={() => pick(null)}>{chip.title}</Chip>
            : chips.map((c) => <Chip key={c.title} onClick={() => pick(c)}>{c.title}</Chip>)}
        </div>
      )}

      {data && !data.personalized && state !== "loading" && (
        <div className="mb-8 p-5 rounded-2xl bg-s1 flex items-center gap-4">
          <div className="flex-1 min-w-0"><div className="font-semibold">Entre para ver a sua Início</div><div className="text-t3 text-[0.88rem]">Sem conta, o YouTube Music mostra recomendações gerais. Conectada, a Início passa a refletir o que você ouve.</div></div>
          <Btn variant="primary" icon={<LogIn />} onClick={() => openDialog("login", { service: "youtube" })}>Entrar</Btn>
        </div>
      )}

      {state === "loading" && !data?.sections.length ? <Skeleton /> : state === "error" && !data?.sections.length ? (
        <Empty icon={<WifiOff />} title="Não foi possível carregar a Início" text={error}><Btn variant="primary" onClick={() => load(chip, true)}>Tentar de novo</Btn></Empty>
      ) : (<>
        {state === "loading" && <div className="text-t3 text-[0.86rem] mb-4">Carregando…</div>}
        {data && <RemoteSections sections={data.sections} />}
        {data?.cont && <div ref={sentinel} className="h-16 grid place-items-center text-t3 text-[0.86rem]">{more ? "Carregando mais…" : ""}</div>}
        {data && !data.sections.length && state === "ok" && <Empty icon={<WifiOff />} title="Nada por aqui" text="O YouTube Music não devolveu seções para esta escolha." />}
      </>)}
    </div>
  );
}
