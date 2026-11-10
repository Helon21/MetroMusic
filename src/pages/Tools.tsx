import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { Ban, Check, Copy, Crown, DoorOpen, Download, Ellipsis, FileUp, History as HistoryIcon, ListPlus, LogIn, Mic, Play, Plus, RefreshCw, RotateCcw, ScrollText, Search, Settings, Share2, Trash2, UserMinus, Users, Volume2, VolumeX, Wand2, Wifi, WifiOff, X, Headphones, SlidersHorizontal } from "lucide-react";
import { artistOf, getTrack, sample, songs } from "../lib/catalog";
import { trackMenu } from "../lib/menus";
import { copyText, cx, dayLabel, norm } from "../lib/util";
import { useLib } from "../store/library";
import { useCurrent, usePlayer } from "../store/player";
import { setSetting, useSetting } from "../store/settings";
import { nav, openDialog, toast, useUI } from "../store/ui";
import { Badge, Btn, Checkbox, Cover, coverBg, Empty, Eq, IconBtn, Modal, Range, SectionTitle, Segmented, Spinner, Switch, TextField } from "../components/ui";

// ───────── Ouvir junto (sessão simulada)
interface Member { id: string; name: string; host?: boolean; you?: boolean; hue: number; muted?: boolean }
interface LT {
  conn: "off" | "connecting" | "on" | "error"; room: string | null; role: "host" | "guest" | null; waiting: boolean;
  members: Member[]; requests: Member[]; suggestions: { id: number; by: string; trackId: string }[]; blocked: string[]; logs: string[];
  log: (m: string) => void; connect: () => void; disconnect: () => void; create: (name: string) => void; join: (name: string, code: string) => void; leave: () => void;
}
const ts = () => new Date().toLocaleTimeString("pt-BR");
let timers: ReturnType<typeof setTimeout>[] = [];
const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
export const useLT = create<LT>((set, get) => ({
  conn: "off", room: null, role: null, waiting: false, members: [], requests: [], suggestions: [], blocked: [], logs: [],
  log: (m) => set((s) => ({ logs: [`[${ts()}] ${m}`, ...s.logs].slice(0, 80) })),
  connect: () => { set({ conn: "connecting" }); get().log("Conectando a wss://together.metromusic.app…"); later(900, () => { set({ conn: "on" }); get().log("Conectado. Latência: 38 ms"); }); },
  disconnect: () => { timers.forEach(clearTimeout); timers = []; set({ conn: "off", room: null, role: null, members: [], requests: [], suggestions: [], waiting: false }); get().log("Desconectado"); },
  create: (name) => {
    const room = Math.random().toString(36).slice(2, 8).toUpperCase();
    set({ room, role: "host", members: [{ id: "me", name, host: true, you: true, hue: 295 }] }); get().log(`Sala criada: ${room}`); toast(`Sala criada: ${room}`);
    later(3500, () => { if (get().room !== room) return; set((s) => ({ requests: [...s.requests, { id: "luiza", name: "luiza_m", hue: 20 }] })); get().log("luiza_m pediu para entrar"); toast("luiza_m quer entrar na sala", { label: "Aprovar", fn: () => approve("luiza") }); });
    later(9000, () => { if (get().room !== room) return; set((s) => ({ requests: [...s.requests, { id: "pedro", name: "pedroh", hue: 150 }] })); get().log("pedroh pediu para entrar"); });
  },
  join: (name, code) => {
    set({ waiting: true }); get().log(`Entrando na sala ${code}…`);
    later(1800, () => { set({ waiting: false, room: code, role: "guest", members: [{ id: "h", name: "pedroh", host: true, hue: 150 }, { id: "b", name: "bia", hue: 60 }, { id: "me", name, you: true, hue: 295 }] }); get().log("Pedido aprovado pelo anfitrião"); toast("Você entrou na sala"); usePlayer.getState().play(sample(songs, 12, 5).map((t) => t.id), 0, `Sala ${code}`); });
  },
  leave: () => { set({ room: null, role: null, members: [], requests: [], suggestions: [] }); get().log("Você saiu da sala"); },
}));
function approve(id: string) {
  const s = useLT.getState(); const m = s.requests.find((r) => r.id === id); if (!m) return;
  useLT.setState({ requests: s.requests.filter((r) => r.id !== id), members: [...s.members, m] }); s.log(`${m.name} entrou na sala`);
  later(5000, () => { if (!useLT.getState().members.some((x) => x.id === id)) return; const t = sample(songs, 1, Date.now())[0]; useLT.setState((x) => ({ suggestions: [...x.suggestions, { id: Date.now(), by: m.name, trackId: t.id }] })); useLT.getState().log(`${m.name} sugeriu "${t.title}"`); toast(`${m.name} sugeriu ${t.title}`); });
}

export function TogetherPage() {
  const lt = useLT();
  const username = useSetting<string>("ltUsername"), autoJoin = useSetting<boolean>("ltAutoJoin"), autoSug = useSetting<boolean>("ltAutoSuggest"), syncVol = useSetting<boolean>("ltSyncVolume");
  const [code, setCode] = useState(""); const [logs, setLogs] = useState(false);
  const openMenuAt = useUI((s) => s.openMenuAt);
  const cur = useCurrent(); const playing = usePlayer((s) => s.playing);
  useEffect(() => { if (autoJoin && lt.requests.length) lt.requests.forEach((r) => approve(r.id)); }, [autoJoin, lt.requests.length]);
  useEffect(() => { if (autoSug && lt.suggestions.length) { usePlayer.getState().addToQueue(lt.suggestions.map((s) => s.trackId)); useLT.setState({ suggestions: [] }); } }, [autoSug, lt.suggestions.length]);
  const status = { off: ["Desconectado", "bg-t3"], connecting: ["Conectando…", "bg-warn"], on: ["Conectado", "bg-ok"], error: ["Erro de conexão", "bg-danger"] }[lt.conn];
  const nameOk = username.trim().length > 0;
  return (
    <div className="px-8 pt-5 pb-10 max-w-[70rem] mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-[2.1rem] font-bold tracking-tight flex-1">Ouvir junto</h1>
        <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-s2 text-[0.84rem] font-medium"><span className={cx("size-2 rounded-full", status[1], lt.conn === "connecting" && "animate-pulse")} />{status[0]}</span>
        <IconBtn label="Registros de conexão" onClick={() => setLogs(true)}><ScrollText /></IconBtn>
        <IconBtn label="Configurações do Ouvir junto" onClick={() => nav("settings/together_settings")}><Settings /></IconBtn>
        {lt.conn === "on" ? <Btn variant="outline" icon={<WifiOff />} onClick={lt.disconnect}>Desconectar</Btn> : <Btn variant="primary" icon={lt.conn === "connecting" ? <Spinner /> : <Wifi />} disabled={lt.conn === "connecting"} onClick={lt.connect}>Conectar</Btn>}
      </div>
      <p className="text-t2 max-w-2xl mb-7">Ouça música com seus amigos em tempo real. Crie uma sala para ser o anfitrião ou entre numa sala existente com um código.</p>

      {lt.room ? (
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] max-[1000px]:grid-cols-1 gap-6">
          <div className="space-y-6">
            <div className="relative rounded-3xl overflow-hidden p-6 text-white">
              <div className="absolute inset-0" style={{ background: cur ? coverBg(cur.hue, cur.seed) : "var(--s2)" }} /><div className="absolute inset-0 bg-black/60 backdrop-blur-2xl" />
              <div className="relative flex items-center gap-2 mb-5"><Badge tone="accent" className="!bg-white/20 !text-white">{lt.role === "host" ? <><Crown />Você é o anfitrião</> : "Você é convidado"}</Badge><div className="flex-1" /><span className="text-white/70 text-[0.8rem]">Código da sala</span>
                <button title="Copiar código" onClick={() => { copyText(lt.room!); toast("Código copiado"); }} className="h-9 px-3.5 rounded-xl bg-white/15 hover:bg-white/25 font-mono font-bold tracking-[0.25em] text-[1.1rem] inline-flex items-center gap-2">{lt.room}<Copy className="size-4" /></button></div>
              {cur && <div className="relative flex items-center gap-5"><Cover hue={cur.hue} seed={cur.seed} src={cur.art} className="size-28 rounded-2xl shadow-2xl" /><div className="min-w-0 flex-1"><div className="text-white/70 text-[0.8rem] font-semibold uppercase tracking-wider flex items-center gap-2">{playing && <Eq />}Tocando para {lt.members.length} {lt.members.length === 1 ? "pessoa" : "pessoas"}</div><div className="text-[1.6rem] font-bold tracking-tight truncate">{cur.title}</div><div className="text-white/75 truncate">{artistOf(cur)}</div></div></div>}
              <div className="relative flex gap-2 mt-6">
                {lt.role === "guest" && <Btn className="!bg-white/15 !text-white" icon={<RefreshCw />} onClick={() => toast("Ressincronizado com o anfitrião")}>Ressincronizar</Btn>}
                <Btn className="!bg-white/15 !text-white" icon={<Share2 />} onClick={() => { copyText(`https://metromusic.app/together/${lt.room}`); toast("Convite copiado"); }}>Convidar</Btn>
                <div className="flex-1" /><Btn variant="danger" className="!bg-danger/30 !text-white" icon={<DoorOpen />} onClick={() => { lt.leave(); toast("Você saiu da sala"); }}>Sair da sala</Btn>
              </div>
            </div>
            {lt.role === "host" && (
              <div className="rounded-2xl bg-s1 divide-y divide-line">
                {([["ltAutoJoin", "Aprovar entradas automaticamente", "Dispensa a revisão manual dos pedidos", autoJoin], ["ltAutoSuggest", "Aprovar sugestões automaticamente", "Sugestões dos convidados vão direto para a fila", autoSug], ["ltSyncVolume", "Sincronizar o volume do anfitrião", "Os convidados acompanham o seu volume", syncVol]] as [string, string, string, boolean][]).map(([k, l, d, v]) => <div key={k} className="flex items-center gap-4 p-4"><div className="flex-1"><div className="font-medium">{l}</div><div className="text-t3 text-[0.84rem]">{d}</div></div><Switch on={v} onChange={(x) => setSetting(k, x)} /></div>)}
              </div>
            )}
            {lt.role === "guest" && <div className="rounded-2xl bg-s1 p-5"><div className="font-semibold mb-1">Quer tocar a sua favorita?</div><div className="text-t3 text-[0.88rem] mb-3">Clique com o botão direito em qualquer música e escolha "Sugerir ao anfitrião".</div><Btn icon={<Search />} onClick={() => window.dispatchEvent(new Event("focus-search"))}>Procurar uma música</Btn></div>}
          </div>
          <div className="space-y-6">
            <div><SectionTitle>Pessoas conectadas <span className="text-t3 font-medium text-[1rem]">{lt.members.length}</span></SectionTitle>
              <div className="rounded-2xl bg-s1 p-1.5"><AnimatePresence initial={false}>{lt.members.map((m) => (
                <motion.div key={m.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 px-2.5 h-14 rounded-xl hover:bg-s2">
                  <div className="size-9 rounded-full grid place-items-center font-bold text-white" style={{ background: `oklch(0.6 0.15 ${m.hue})` }}>{m.name[0].toUpperCase()}</div>
                  <span className="font-medium flex-1 truncate">{m.name}</span>
                  {m.host && <Badge tone="accent"><Crown />Anfitrião</Badge>}{m.you && <Badge>Você</Badge>}
                  {lt.role === "host" && !m.you && <IconBtn label="Gerenciar pessoa" size={30} onClick={(e) => openMenuAt(e.currentTarget, [
                    { header: true, label: m.name },
                    { label: m.muted ? "Reativar som" : "Silenciar", icon: m.muted ? <Volume2 /> : <VolumeX />, onClick: () => useLT.setState((s) => ({ members: s.members.map((x) => (x.id === m.id ? { ...x, muted: !x.muted } : x)) })) },
                    { label: "Transferir a sala", icon: <Crown />, onClick: () => { useLT.setState((s) => ({ role: "guest", members: s.members.map((x) => ({ ...x, host: x.id === m.id })) })); toast(`${m.name} agora é o anfitrião`); } },
                    { divider: true },
                    { label: "Remover da sala", icon: <UserMinus />, danger: true, onClick: () => { useLT.setState((s) => ({ members: s.members.filter((x) => x.id !== m.id) })); lt.log(`${m.name} foi removido`); } },
                    { label: "Bloquear para sempre", icon: <Ban />, danger: true, onClick: () => { useLT.setState((s) => ({ members: s.members.filter((x) => x.id !== m.id), blocked: [...s.blocked, m.name] })); toast(`${m.name} foi bloqueado`); } },
                  ])}><Ellipsis /></IconBtn>}
                </motion.div>))}</AnimatePresence></div></div>
            {lt.role === "host" && lt.requests.length > 0 && <div><SectionTitle>Pedidos de entrada</SectionTitle><div className="rounded-2xl bg-s1 p-1.5">{lt.requests.map((r) => <div key={r.id} className="flex items-center gap-3 px-2.5 h-14"><div className="size-9 rounded-full grid place-items-center font-bold text-white" style={{ background: `oklch(0.6 0.15 ${r.hue})` }}>{r.name[0].toUpperCase()}</div><span className="font-medium flex-1">{r.name}</span><Btn size="sm" variant="ghost" onClick={() => useLT.setState((s) => ({ requests: s.requests.filter((x) => x.id !== r.id) }))}>Recusar</Btn><Btn size="sm" variant="primary" icon={<Check />} onClick={() => approve(r.id)}>Aprovar</Btn></div>)}</div></div>}
            {lt.role === "host" && lt.suggestions.length > 0 && <div><SectionTitle>Sugestões pendentes</SectionTitle><div className="rounded-2xl bg-s1 p-1.5">{lt.suggestions.map((s) => { const t = getTrack(s.trackId)!; return <div key={s.id} className="flex items-center gap-3 px-2.5 h-15"><Cover hue={t.hue} seed={t.seed} src={t.art} className="size-10 rounded-md" /><div className="min-w-0 flex-1"><div className="truncate font-medium">{t.title}</div><div className="truncate text-t3 text-[0.8rem]">{artistOf(t)} · sugerida por {s.by}</div></div><IconBtn label="Recusar" size={32} onClick={() => useLT.setState((x) => ({ suggestions: x.suggestions.filter((y) => y.id !== s.id) }))}><X /></IconBtn><IconBtn label="Aprovar e pôr na fila" size={32} className="!bg-accent !text-accent-fg" onClick={() => { usePlayer.getState().addToQueue([s.trackId]); useLT.setState((x) => ({ suggestions: x.suggestions.filter((y) => y.id !== s.id) })); }}><Check /></IconBtn></div>; })}</div></div>}
            {lt.blocked.length > 0 && <div><SectionTitle>Bloqueados</SectionTitle><div className="rounded-2xl bg-s1 p-1.5">{lt.blocked.map((b) => <div key={b} className="flex items-center gap-3 px-3 h-12"><Ban className="size-4 text-t3" /><span className="flex-1">{b}</span><Btn size="sm" variant="ghost" onClick={() => useLT.setState((s) => ({ blocked: s.blocked.filter((x) => x !== b) }))}>Desbloquear</Btn></div>)}</div></div>}
          </div>
        </div>
      ) : lt.waiting ? (
        <div className="grid place-items-center h-72 rounded-3xl bg-s1"><div className="text-center"><Spinner className="size-8 mx-auto mb-4 text-accent" /><div className="text-[1.15rem] font-semibold">Aguardando a aprovação do anfitrião…</div><Btn variant="ghost" className="mt-4" onClick={() => { timers.forEach(clearTimeout); useLT.setState({ waiting: false }); }}>Cancelar</Btn></div></div>
      ) : (
        <div className={cx("grid grid-cols-2 max-[900px]:grid-cols-1 gap-5 transition-opacity", lt.conn !== "on" && "opacity-50 pointer-events-none")}>
          <div className="col-span-full rounded-2xl bg-s1 p-5 flex items-center gap-4"><div className="flex-1"><div className="font-semibold mb-2">Nome de usuário</div><TextField value={username} onChange={(v) => setSetting("ltUsername", v)} placeholder="Como os outros veem você" className="max-w-sm" /></div>{!nameOk && <span className="text-danger text-[0.86rem]">É preciso informar um nome</span>}</div>
          <div className="rounded-3xl bg-s1 p-7 flex flex-col"><div className="size-14 rounded-2xl bg-accent-soft text-accent grid place-items-center mb-5"><Plus className="size-7" /></div><div className="text-[1.3rem] font-bold tracking-tight">Criar sala</div><p className="text-t3 mt-1 mb-6 flex-1">Crie uma sala e compartilhe o código com seus amigos. Você controla a fila e a reprodução.</p><Btn variant="primary" size="lg" disabled={!nameOk} onClick={() => lt.create(username)}>Criar sala</Btn></div>
          <div className="rounded-3xl bg-s1 p-7 flex flex-col"><div className="size-14 rounded-2xl bg-accent-soft text-accent grid place-items-center mb-5"><LogIn className="size-7" /></div><div className="text-[1.3rem] font-bold tracking-tight">Entrar numa sala</div><p className="text-t3 mt-1 mb-4 flex-1">Digite o código que o anfitrião compartilhou.</p>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="CÓDIGO" className="h-14 rounded-xl bg-s2 text-center font-mono text-[1.5rem] font-bold tracking-[0.4em] placeholder:text-t3/50 mb-3 border border-transparent focus:border-accent/50" />
            <Btn size="lg" disabled={!nameOk || code.length < 6} onClick={() => lt.join(username, code)}>{code.length > 0 && code.length < 6 ? "Código inválido" : "Entrar"}</Btn></div>
        </div>
      )}
      {lt.conn === "off" && !lt.room && <div className="mt-5 text-t3 text-[0.84rem]">Conecte-se ao servidor para criar ou entrar numa sala. Conectado sem estar numa sala, o Ouvir junto se desconecta após 30 minutos em segundo plano.</div>}
      <AnimatePresence>{logs && <Modal title="Registros de conexão" width={600} onClose={() => setLogs(false)} footer={<><Btn variant="ghost" onClick={() => useLT.setState({ logs: [] })}>Limpar</Btn><Btn icon={<Copy />} onClick={() => { copyText(lt.logs.join("\n")); toast("Registros copiados"); }}>Copiar</Btn></>}>{lt.logs.length ? <pre className="font-mono text-[0.8rem] leading-relaxed text-t2 whitespace-pre-wrap select-text">{lt.logs.join("\n")}</pre> : <div className="text-t3 py-8 text-center">Nenhum registro ainda</div>}</Modal>}</AnimatePresence>
    </div>
  );
}

// ───────── Reconhecer música
export function RecognizePage() {
  const [state, setState] = useState<"idle" | "listening" | "processing" | "match" | "none" | "error">("idle");
  const [found, setFound] = useState<string | null>(null);
  const [tab, setTab] = useState<"now" | "history">("now");
  const recs = useLib((s) => s.recognitions);
  const attempts = useRef(0); const timer = useRef<ReturnType<typeof setTimeout>[]>([]);
  const openMenu = useUI((s) => s.openMenu);
  const stop = () => { timer.current.forEach(clearTimeout); timer.current = []; };
  useEffect(() => stop, []);
  const start = () => {
    stop(); setState("listening"); attempts.current++;
    timer.current.push(setTimeout(() => setState("processing"), 3800));
    timer.current.push(setTimeout(() => {
      if (attempts.current % 4 === 0) return setState("none");
      const t = sample(songs, 1, Date.now())[0]; setFound(t.id); setState("match"); useLib.getState().addRecognition(t.id);
    }, 5200));
  };
  const t = found ? getTrack(found) : null;
  const busy = state === "listening" || state === "processing";
  return (
    <div className="px-8 pt-5 pb-10">
      <div className="flex items-center gap-3 mb-4"><h1 className="text-[2.1rem] font-bold tracking-tight flex-1">Reconhecer música</h1><Segmented id="rec" value={tab} onChange={setTab} options={[["now", <><Mic />Ouvir</>], ["history", <><HistoryIcon />Histórico</>]]} /></div>
      {tab === "now" ? (
        <div className="flex flex-col items-center pt-8">
          <AnimatePresence mode="wait">
            {state === "match" && t ? (
              <motion.div key="m" initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} className="relative w-full max-w-xl rounded-3xl overflow-hidden p-7 text-white">
                <div className="absolute inset-0" style={{ background: coverBg(t.hue, t.seed) }} /><div className="absolute inset-0 bg-black/55 backdrop-blur-2xl" />
                <div className="relative flex gap-6 items-center"><Cover hue={t.hue} seed={t.seed} src={t.art} className="size-40 rounded-2xl shadow-2xl" />
                  <div className="min-w-0 flex-1"><div className="text-white/70 text-[0.78rem] font-semibold uppercase tracking-widest mb-1">Encontramos</div><div className="text-[1.8rem] font-bold tracking-tight leading-tight">{t.title}</div><button className="text-white/80 text-[1.1rem] hover:underline" onClick={() => nav(`artist/${t.artistId}`)}>{artistOf(t)}</button>
                    <div className="flex flex-wrap gap-2 mt-5"><Btn className="!bg-white !text-black" icon={<Play fill="currentColor" />} onClick={() => usePlayer.getState().play([t.id], 0, "Reconhecidas")}>Tocar no MetroMusic</Btn><IconBtn label="Mais opções" className="!text-white bg-white/15" onClick={(e) => openMenu(e, trackMenu(t))}><Ellipsis /></IconBtn></div></div></div>
                <div className="relative flex gap-2 mt-6"><Btn className="!bg-white/15 !text-white" icon={<Mic />} onClick={start}>Ouvir de novo</Btn><Btn variant="ghost" className="!text-white" onClick={() => setState("idle")}>Fechar</Btn></div>
              </motion.div>
            ) : (
              <motion.div key="i" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center">
                <div className="relative size-72 grid place-items-center">
                  {busy && [0, 0.6, 1.2].map((d) => <span key={d} className="absolute size-40 rounded-full border-2 border-accent" style={{ animation: "pulse-ring 1.8s ease-out infinite", animationDelay: `${d}s` }} />)}
                  <motion.button aria-label={busy ? "Cancelar" : "Toque para reconhecer"} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }} onClick={() => (busy ? (stop(), setState("idle")) : start())}
                    animate={busy ? { scale: [1, 1.06, 1] } : { scale: 1 }} transition={busy ? { repeat: Infinity, duration: 1.2 } : {}}
                    className="relative size-40 rounded-full bg-accent text-accent-fg grid place-items-center shadow-2xl" style={{ boxShadow: "0 20px 60px -10px var(--accent)" }}>
                    {state === "processing" ? <Spinner className="size-14" /> : <Mic className="size-16" strokeWidth={1.6} />}
                  </motion.button>
                </div>
                <div className="text-[1.5rem] font-bold tracking-tight mt-2">{{ idle: "Toque para reconhecer", listening: "Ouvindo…", processing: "Identificando…", none: "Nenhuma correspondência", error: "Erro no reconhecimento", match: "" }[state]}</div>
                <div className="text-t3 mt-1.5 h-6">{{ idle: "Identifique a música que está tocando ao seu redor ou no computador.", listening: "Aproxime o microfone da fonte do som.", processing: "Comparando a amostra com o catálogo.", none: "Não conseguimos identificar. Tente de novo mais perto do som.", error: "Algo deu errado. Tente novamente.", match: "" }[state]}</div>
                <div className="flex gap-2 mt-6 h-10">{busy ? <Btn variant="ghost" onClick={() => { stop(); setState("idle"); }}>Cancelar</Btn> : state === "none" ? <Btn variant="primary" icon={<RotateCcw />} onClick={start}>Tentar de novo</Btn> : null}</div>
                <div className="mt-8 flex items-center gap-3 text-t3 text-[0.84rem]"><span>Captar de:</span><Segmented id="rec-src" value="mic" onChange={() => toast("A captura do áudio do sistema chega com o backend")} options={[["mic", "Microfone"], ["sys", "Áudio do computador"]]} /></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : recs.length === 0 ? <Empty icon={<HistoryIcon />} title="Nenhuma música reconhecida" text="O que você identificar fica guardado aqui." /> : (
        <div className="max-w-3xl">
          <div className="flex justify-end mb-2"><Btn size="sm" variant="ghost" icon={<Trash2 />} onClick={() => openDialog("confirm", { title: "Limpar o histórico de reconhecimento?", text: "Todas as músicas reconhecidas serão removidas da lista.", confirm: "Limpar", danger: true, action: () => useLib.getState().clear("recognitions") })}>Limpar histórico</Btn></div>
          {recs.map((r) => { const x = getTrack(r.id)!; return (
            <div key={r.at} className="group flex items-center gap-4 h-16 px-3 rounded-xl hover:bg-s2" onContextMenu={(e) => openMenu(e, trackMenu(x))}>
              <Cover hue={x.hue} seed={x.seed} src={x.art} className="size-12 rounded-lg" /><div className="min-w-0 flex-1"><div className="truncate font-medium">{x.title}</div><div className="truncate text-t3 text-[0.84rem]">{artistOf(x)}</div></div>
              <span className="text-t3 text-[0.82rem]">{dayLabel(r.at)}</span>
              <IconBtn label="Tocar" className="opacity-0 group-hover:opacity-100" onClick={() => usePlayer.getState().play([x.id], 0, "Reconhecidas")}><Play /></IconBtn>
              <IconBtn label="Adicionar à playlist" className="opacity-0 group-hover:opacity-100" onClick={(e) => openMenu(e, trackMenu(x).find((m) => m.sub)!.sub!)}><ListPlus /></IconBtn>
              <IconBtn label="Remover do histórico" className="opacity-0 group-hover:opacity-100" onClick={() => useLib.getState().removeRecognition(r.at)}><Trash2 /></IconBtn>
            </div>); })}
        </div>
      )}
    </div>
  );
}

// ───────── Equalizador
const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FREQ_KEYS = ["eq31", "eq62", "eq125", "eq250", "eq500", "eq1k", "eq2k", "eq4k", "eq8k", "eq16k"] as const;
interface Profile { id: string; name: string; gains: number[]; preamp: number; auto?: boolean }
const PRESETS: Profile[] = [
  { id: "flat", name: "Plano", gains: Array(10).fill(0), preamp: 0 },
  { id: "bass", name: "Reforço de graves", gains: [6, 5, 3.5, 1.5, 0, 0, 0, 0, 0.5, 1], preamp: -4 },
  { id: "vocal", name: "Voz em destaque", gains: [-2, -1.5, -1, 0.5, 2.5, 3.5, 3, 1.5, 0, -1], preamp: -3 },
  { id: "v", name: "Curva em V", gains: [5, 4, 2, 0, -2, -2, 0, 2.5, 4, 5], preamp: -4 },
  { id: "hd600", name: "Sennheiser HD 600 (AutoEQ)", gains: [5.2, 3.1, 0.8, -0.6, 0.2, 0.4, -1.2, 1.8, -2.4, 0.6], preamp: -5.4, auto: true },
];
const MODELS = ["Sony WH-1000XM4", "Sony WH-1000XM5", "Sennheiser HD 560S", "Sennheiser HD 600", "Sennheiser HD 650", "Bose QuietComfort 45", "Apple AirPods Pro 2", "Beyerdynamic DT 770 Pro", "Audio-Technica ATH-M50x", "Samsung Galaxy Buds2 Pro", "KZ ZSN Pro X", "Moondrop Aria", "HiFiMAN Sundara", "AKG K371", "JBL Tune 510BT"];

function Curve({ gains, on }: { gains: number[]; on: boolean }) {
  const W = 800, H = 220, pad = 10;
  const x = (i: number) => pad + (i / (gains.length - 1)) * (W - pad * 2), y = (g: number) => H / 2 - (g / 12) * (H / 2 - 16);
  const pts = gains.map((g, i) => [x(i), y(g)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; const mx = (x0 + x1) / 2; d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`; }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-52" preserveAspectRatio="none">
      {[-12, -6, 0, 6, 12].map((g) => <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={g === 0 ? 1.5 : 1} strokeDasharray={g === 0 ? "" : "3 5"} vectorEffect="non-scaling-stroke" />)}
      <motion.path animate={{ d: `${d} L${W - pad},${H} L${pad},${H} Z` }} transition={{ type: "spring", stiffness: 200, damping: 26 }} fill="var(--accent)" opacity={on ? 0.12 : 0.04} />
      <motion.path animate={{ d }} transition={{ type: "spring", stiffness: 200, damping: 26 }} fill="none" stroke={on ? "var(--accent)" : "var(--t3)"} strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pts.map(([px, py], i) => <motion.circle key={i} animate={{ cx: px, cy: py }} transition={{ type: "spring", stiffness: 200, damping: 26 }} r={4} fill={on ? "var(--accent)" : "var(--t3)"} />)}
    </svg>
  );
}

function applyProfile(p: Profile) {
  setSetting("eqOn", true);
  setSetting("eqPreamp", p.preamp);
  FREQ_KEYS.forEach((k, i) => setSetting(k, p.gains[i]));
  toast(`Perfil "${p.name}" aplicado`);
}

export function EqualizerPage() {
  const [wizard, setWizard] = useState(false);
  const on = useSetting<boolean>("eqOn");
  const preamp = useSetting<number>("eqPreamp");
  const gains = FREQ_KEYS.map((k) => useSetting<number>(k));
  const activeId = useRef<string>("flat");

  const p = PRESETS.find((x) => x.id === activeId.current) ?? PRESETS[0];

  const applyAndSelect = (profile: Profile) => {
    activeId.current = profile.id;
    applyProfile(profile);
  };

  return (
    <div className="px-8 pt-5 pb-10 max-w-[76rem] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-[2.1rem] font-bold tracking-tight flex-1">Equalizador</h1>
        <Btn icon={<Wand2 />} onClick={() => setWizard(true)}>Assistente AutoEQ</Btn>
        <Btn variant="ghost" icon={<FileUp />} onClick={() => {
          const id = `c${Date.now()}`;
          const imported: Profile = { id, name: "Importado: ParametricEQ.txt", gains: [3, 2, 0, -1, 0, 1, 2, 0, -2, 1], preamp: -3.2 };
          PRESETS.push(imported);
          applyAndSelect(imported);
          toast("Perfil importado");
        }}>Importar perfil</Btn>
        <div className="flex items-center gap-2.5 pl-3"><span className={cx("font-medium", !on && "text-t3")}>{on ? "Ativado" : "Desativado"}</span><Switch on={on} onChange={(v) => setSetting("eqOn", v)} /></div>
      </div>
      <div className="grid grid-cols-[17rem_minmax(0,1fr)] max-[1000px]:grid-cols-1 gap-6">
        <div>
          <div className="text-[0.72rem] font-semibold uppercase tracking-wider text-t3 mb-2 px-1">Perfis</div>
          <div className="space-y-1">{PRESETS.map((x) => (
            <div key={x.id} role="button" onClick={() => applyAndSelect(x)} className={cx("group w-full flex items-center gap-3 h-12 px-3 rounded-xl text-left transition-colors", x.id === activeId.current ? "bg-accent-soft" : "hover:bg-s2")}>
              {x.auto ? <Headphones className="size-4.5 text-t3 shrink-0" /> : <SlidersHorizontal className="size-4.5 text-t3 shrink-0" />}<span className={cx("flex-1 truncate font-medium text-[0.9rem]", x.id === activeId.current && "text-accent")}>{x.name}</span>
              {x.id.startsWith("c") && <IconBtn label="Apagar perfil" size={28} className="opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); openDialog("confirm", { title: "Apagar perfil?", text: `Tem certeza de que quer apagar "${x.name}"? Esta ação não pode ser desfeita.`, confirm: "Apagar", danger: true, action: () => { const idx = PRESETS.findIndex((y) => y.id === x.id); if (idx >= 0) PRESETS.splice(idx, 1); if (activeId.current === x.id) { activeId.current = "flat"; applyProfile(PRESETS[0]); } toast("Perfil apagado"); } }); }}><Trash2 /></IconBtn>}
            </div>))}</div>
        </div>
        <div className={cx("rounded-3xl bg-s1 p-6 transition-opacity", !on && "opacity-60")}>
          <div className="flex items-center gap-3 mb-2"><div className="font-semibold text-[1.1rem] flex-1 truncate">{p.name}</div><Btn size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => { FREQ_KEYS.forEach((k) => setSetting(k, 0)); setSetting("eqPreamp", 0); toast("Equalizador zerado"); }}>Zerar</Btn></div>
          <div className="relative"><Curve gains={gains} on={on} /><div className="absolute left-1 top-1 text-t3 text-[0.7rem] tnum">+12 dB</div><div className="absolute left-1 bottom-1 text-t3 text-[0.7rem] tnum">−12 dB</div></div>
          <div className="grid grid-cols-[repeat(10,minmax(0,1fr))] gap-1 mt-4">
            {FREQS.map((f, i) => (
              <div key={f} className="flex flex-col items-center gap-2 min-w-0">
                <span className="text-[0.74rem] tnum font-medium text-t2 h-4">{gains[i] > 0 ? "+" : ""}{gains[i].toFixed(1).replace(".", ",")}</span>
                <div className="relative h-36 w-6"><Range label={`${f} Hz`} vertical value={gains[i]} min={-12} max={12} step={0.5} onChange={(v) => setSetting(FREQ_KEYS[i], v)} className="absolute left-1/2 top-1/2 w-36 -translate-x-1/2 -translate-y-1/2 thumb" /></div>
                <span className="text-[0.72rem] text-t3 tnum">{f >= 1000 ? `${f / 1000}k` : f}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-6 pt-5 border-t border-line"><span className="font-medium w-36">Pré-amplificação</span><Range value={preamp} min={-12} max={6} step={0.1} onChange={(v) => setSetting("eqPreamp", v)} className="flex-1 thumb" /><span className="w-20 text-right tnum text-t2">{preamp.toFixed(1).replace(".", ",")} dB</span></div>
          {preamp > 0 && <div className="mt-3 text-warn text-[0.84rem]">Pré-amplificação positiva pode causar distorção em trechos altos.</div>}
        </div>
      </div>
      <AnimatePresence>{wizard && <Wizard onClose={() => setWizard(false)} onSave={(names) => { const added = names.map((n, i) => ({ id: `c${Date.now() + i}`, name: `${n} (AutoEQ)`, gains: FREQS.map((_, k) => +(Math.sin(k * 1.3 + n.length + i) * 4).toFixed(1)), preamp: -4.5, auto: true })); added.forEach((a) => PRESETS.push(a)); applyAndSelect(added[0]); toast(`${added.length} ${added.length === 1 ? "perfil salvo" : "perfis salvos"}`); }} />}</AnimatePresence>
    </div>
  );
}

function Wizard({ onClose, onSave }: { onClose: () => void; onSave: (names: string[]) => void }) {
  const [step, setStep] = useState<"db" | "model" | "variants">("db"); const [pct, setPct] = useState<number | null>(null);
  const [q, setQ] = useState(""); const [model, setModel] = useState(""); const [sel, setSel] = useState<string[]>([]);
  const list = useMemo(() => MODELS.filter((m) => norm(m).includes(norm(q))), [q]);
  const variants = ["oratory1990", "Rtings", "Crinacle", "Innerfidelity"].map((s) => `${model} · ${s}`);
  useEffect(() => { if (pct === null) return; if (pct >= 100) { setStep("model"); return; } const t = setTimeout(() => setPct(pct + 5), 60); return () => clearTimeout(t); }, [pct]);
  return (
    <Modal title="Assistente AutoEQ" subtitle={step === "db" ? "Corrige a resposta do seu fone com medições públicas" : step === "model" ? "Passo 1 de 2 · Escolha o modelo" : `Passo 2 de 2 · Perfis para ${model}`} width={520} onClose={onClose}
      footer={step === "variants" ? <><Btn variant="ghost" onClick={() => setStep("model")}>Voltar</Btn><Btn variant="primary" disabled={!sel.length} onClick={() => { onSave(sel); onClose(); }}>Salvar perfis</Btn></> : undefined}>
      {step === "db" && <div className="text-center py-4"><Download className="size-10 mx-auto text-accent mb-3" /><p className="text-t2 mb-5">O assistente precisa do banco de dados do AutoEQ, com medições de milhares de fones.</p>{pct === null ? <Btn variant="primary" onClick={() => setPct(0)}>Baixar o banco AutoEQ (17 MB)</Btn> : <><div className="h-2 rounded-full bg-s3 overflow-hidden"><div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div><div className="text-t3 text-[0.84rem] mt-2">Baixando… {pct}%</div></>}</div>}
      {step === "model" && <><TextField autoFocus value={q} onChange={setQ} placeholder="ex.: Sony WH-1000XM4, Bose QuietComfort 45" icon={<Search />} /><div className="mt-3 max-h-72 overflow-y-auto">{list.length ? list.map((m) => <button key={m} onClick={() => { setModel(m); setSel([]); setStep("variants"); }} className="w-full flex items-center gap-3 h-11 px-3 rounded-lg hover:bg-s2 text-left"><Headphones className="size-4 text-t3" /><span className="flex-1">{m}</span><span className="text-t3 text-[0.78rem]">Várias medições</span></button>) : <div className="text-t3 text-center py-8">Nenhum modelo encontrado</div>}</div></>}
      {step === "variants" && variants.map((v) => { const toggle = () => setSel(sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]); return <div key={v} role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())} className="w-full flex items-center gap-3 h-12 px-3 rounded-lg hover:bg-s2 text-left cursor-default"><Checkbox on={sel.includes(v)} onChange={toggle} /><span>{v}</span></div>; })}
    </Modal>
  );
}
export { Users };
