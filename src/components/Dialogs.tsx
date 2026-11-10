import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { AudioLines, Cast, Check, Copy, Download, FileSpreadsheet, FileText, Link, ListMusic, LogIn, Minus, Monitor, Plus, QrCode, Search, Send, Speaker, Tv, Upload } from "lucide-react";
import { albumOf, artistOf, getArtist, getLyrics, getTrack, sample, songs, SOURCES, sourceName, type SourceId } from "../lib/catalog";
import { coverBg } from "./ui";
import { copyText, cx, fmtCount, fmtTime, norm } from "../lib/util";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { BrandTile, SourceIcon, type BrandId } from "../lib/brands";
import { cancelLogin, loginCookie, loginWeb, logout, useYt } from "../lib/account";
import { loginLastfm, useLastfm } from "../lib/lastfm";
import { cancelScLogin, loginScToken, loginScWeb, useSc } from "../lib/soundcloud";
import { cancelSpLogin, loginSp, loginSpCookie, useSp } from "../lib/spotify";
import { isTauri, toggleMiniWindow } from "../lib/native";
import { getSetting, setSetting, useSetting } from "../store/settings";
import { nav, toast, useUI } from "../store/ui";
import { useLyr } from "./Lyrics";
import { ConfirmFooter } from "./overlays";
import { Btn, Checkbox, Cover, IconBtn, Kbd, Modal, Range, Select, Spinner, Switch, TextField } from "./ui";

type P = { props: any; close: () => void };
const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block mb-4"><div className="text-[0.82rem] font-medium text-t2 mb-1.5">{label}</div>{children}{hint && <div className="text-t3 text-[0.78rem] mt-1.5">{hint}</div>}</label>
);

function CreatePlaylist({ props, close }: P) {
  const [name, setName] = useState(""); const [sync, setSync] = useState(false);
  const n = props.trackIds?.length ?? 0;
  const create = () => { if (!name.trim()) return; const id = useLib.getState().createPlaylist(name.trim(), props.trackIds ?? [], { synced: sync }); close(); toast(n ? `Playlist criada com ${n} músicas` : "Playlist criada", { label: "Abrir", fn: () => nav(`playlist/${id}`) }); if (!n) nav(`playlist/${id}`); };
  return (
    <Modal title="Nova playlist" subtitle={n ? `${n} ${n === 1 ? "música será adicionada" : "músicas serão adicionadas"}` : undefined} onClose={close} footer={<ConfirmFooter onCancel={close} onConfirm={create} confirm="Criar" disabled={!name.trim()} />}>
      <Field label="Nome"><TextField autoFocus value={name} onChange={setName} placeholder="Minha playlist" onEnter={create} /></Field>
      <div className="flex items-center gap-3 p-3.5 rounded-xl bg-s2"><div className="flex-1"><div className="font-medium">Sincronizar com a conta</div><div className="text-t3 text-[0.82rem]">Cria a playlist também no YouTube Music. Não pode ser desfeito depois.</div></div><Switch on={sync} onChange={setSync} /></div>
    </Modal>
  );
}

function EditPlaylist({ props, close }: P) {
  const p = useLib((s) => s.playlists.find((x) => x.id === props.id));
  const [name, setName] = useState(p?.title ?? ""); const [desc, setDesc] = useState(p?.description ?? "");
  if (!p) return null;
  const save = () => { useLib.getState().updatePlaylist(p.id, { title: name.trim() || p.title, description: desc }); close(); toast("Playlist atualizada"); };
  return (
    <Modal title="Editar playlist" onClose={close} footer={<ConfirmFooter onCancel={close} onConfirm={save} confirm="Salvar" disabled={!name.trim()} />}>
      <div className="flex gap-5">
        <button className="shrink-0 self-start" onClick={() => useUI.getState().openDialog("editCover", { id: p.id })}><Cover hue={p.hue} seed={p.seed} className="size-32 rounded-xl" /><div className="text-t3 text-[0.78rem] mt-1.5 text-center hover:text-t1">Trocar capa</div></button>
        <div className="flex-1 min-w-0"><Field label="Nome"><TextField autoFocus value={name} onChange={setName} onEnter={save} /></Field><Field label="Descrição"><TextField value={desc} onChange={setDesc} placeholder="Opcional" /></Field></div>
      </div>
    </Modal>
  );
}

function EditCover({ props, close }: P) {
  const p = useLib((s) => s.playlists.find((x) => x.id === props.id));
  const options = useMemo(() => Array.from({ length: 12 }, (_, i) => ({ hue: (i * 30 + 10) % 360, seed: i * 7919 + 3 })), []);
  if (!p) return null;
  const pick = (o: { hue: number; seed: number }) => { useLib.getState().updatePlaylist(p.id, o); };
  return (
    <Modal title="Capa da playlist" subtitle="Escolha uma arte gerada ou envie uma imagem" width={520} onClose={close} footer={<><Btn variant="ghost" icon={<Upload />} onClick={() => toast("Seletor de arquivos: disponível com o backend")}>Escolher imagem…</Btn><div className="flex-1" /><Btn variant="primary" onClick={close}>Concluir</Btn></>}>
      <div className="grid grid-cols-4 gap-3">{options.map((o, i) => <button key={i} onClick={() => pick(o)} className={cx("rounded-xl transition-transform hover:scale-[1.03]", p.hue === o.hue && p.seed === o.seed && "ring-2 ring-accent ring-offset-2 ring-offset-s1")}><Cover hue={o.hue} seed={o.seed} className="w-full rounded-xl" /></button>)}</div>
    </Modal>
  );
}

function Duplicates({ props, close }: P) {
  const { playlistId, ids, dup } = props as { playlistId: string; ids: string[]; dup: string[] };
  const add = (all: boolean) => { const n = useLib.getState().addToPlaylist(playlistId, all ? ids : ids.filter((i) => !dup.includes(i)), all); close(); toast(n ? `${n} ${n === 1 ? "música adicionada" : "músicas adicionadas"}` : "Nenhuma música nova para adicionar"); };
  return (
    <Modal title="Músicas duplicadas" onClose={close} footer={<><Btn variant="ghost" onClick={close}>Cancelar</Btn><Btn onClick={() => add(true)}>Adicionar mesmo assim</Btn><Btn variant="primary" onClick={() => add(false)}>Pular duplicadas</Btn></>}>
      <p className="text-t2 mb-3">{dup.length === 1 ? "Esta música já está na playlist:" : `${dup.length} músicas já estão na playlist:`}</p>
      <div className="rounded-xl bg-s2 divide-y divide-line max-h-52 overflow-y-auto">{dup.map((id) => { const t = getTrack(id)!; return <div key={id} className="flex items-center gap-3 p-2.5"><Cover hue={t.hue} seed={t.seed} src={t.art} className="size-9 rounded-md" /><div className="min-w-0"><div className="truncate font-medium">{t.title}</div><div className="truncate text-t3 text-[0.8rem]">{artistOf(t)}</div></div></div>; })}</div>
    </Modal>
  );
}

function Confirm({ props, close }: P) {
  return <Modal title={props.title} onClose={close} width={420} footer={<ConfirmFooter onCancel={close} onConfirm={() => { props.action(); close(); }} confirm={props.confirm} danger={props.danger} />}><p className="text-t2 leading-relaxed">{props.text}</p></Modal>;
}

function Share({ props, close }: P) {
  const url = `https://metromusic.app/${props.kind}/${props.id}`;
  const [universal, setUniversal] = useState(true);
  return (
    <Modal title="Compartilhar" subtitle={props.title} onClose={close}>
      <div className="flex items-center gap-2 p-1.5 pl-4 rounded-full bg-s2 mb-4"><Link className="size-4 text-t3 shrink-0" /><span className="flex-1 truncate text-[0.88rem] select-text">{universal ? url.replace("metromusic.app", "song.link") : url}</span><Btn size="sm" variant="primary" icon={<Copy />} onClick={() => { copyText(url); toast("Link copiado"); close(); }}>Copiar</Btn></div>
      <div className="flex items-center gap-3 p-3.5 rounded-xl bg-s2 mb-4"><div className="flex-1"><div className="font-medium">Link universal</div><div className="text-t3 text-[0.82rem]">Quem receber escolhe em qual serviço abrir.</div></div><Switch on={universal} onChange={setUniversal} /></div>
      <div className="grid grid-cols-4 gap-2">
        {([["Mensagem", <Send />], ["Código QR", <QrCode />], ["Ouvir junto", <ListMusic />], ["Arquivo", <FileText />]] as [string, ReactNode][]).map(([l, i]) => <button key={l} onClick={() => { toast(`Compartilhado via ${l.toLowerCase()}`); close(); }} className="flex flex-col items-center gap-2 py-4 rounded-xl hover:bg-s2 text-t2 hover:text-t1 text-[0.8rem] [&>svg]:size-6">{i}{l}</button>)}
      </div>
    </Modal>
  );
}

function Source({ props, close }: P) {
  const t = getTrack(props.id)!;
  const override = usePlayer((s) => s.sourceOverride[t.id]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { const x = setTimeout(() => setLoading(false), 700); return () => clearTimeout(x); }, []);
  const matches = useMemo(() => (["deezer", "tidal", "qobuz", "youtube", "soundcloud", "offline"] as SourceId[]).map((id, i) => ({ id, q: ["FLAC · 16-bit / 44,1 kHz", "Hi-Res · 24-bit / 96 kHz", "Hi-Res · 24-bit / 192 kHz", "Opus · 160 kbps", "AAC · 160 kbps", "Arquivo baixado"][i], conf: [98, 97, 95, 99, 71, 100][i], ms: [182, 240, 310, 95, 420, 2][i] })).filter((m) => m.id !== "offline" || useLib.getState().downloads[t.id] >= 1), [t.id]);
  const set = (id: SourceId | null) => { usePlayer.getState().setSource(t.id, id); toast("Fonte de áudio atualizada"); close(); };
  return (
    <Modal title="Escolher fonte de áudio" subtitle={`${t.title} · ${artistOf(t)}`} width={500} onClose={close}>
      <button onClick={() => set(null)} className={cx("w-full flex items-center gap-3 p-3.5 rounded-xl text-left mb-2 transition-colors", !override ? "bg-accent-soft" : "bg-s2 hover:bg-s3")}>
        <AudioLines className="size-5 text-accent" /><div className="flex-1"><div className="font-medium">Automática</div><div className="text-t3 text-[0.82rem]">Usa a ordem dos provedores e a lógica de correspondência. Agora: {sourceName(t.provider)}</div></div>{!override && <Check className="size-5 text-accent" />}
      </button>
      {loading ? <div className="grid place-items-center h-40 text-t3"><Spinner className="size-6" /></div> : matches.map((m) => (
        <button key={m.id} onClick={() => set(m.id)} className={cx("w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors", override === m.id ? "bg-accent-soft" : "hover:bg-s2")}>
          <SourceIcon id={m.id} size={22} className="mx-0.5" />
          <div className="flex-1 min-w-0"><div className="font-medium">{sourceName(m.id)}</div><div className="text-t3 text-[0.82rem]">{m.q}</div></div>
          <div className="text-right text-[0.78rem] tnum"><div className={m.conf > 90 ? "text-ok" : "text-warn"}>{m.conf}% de correspondência</div><div className="text-t3">{m.ms} ms</div></div>
          {override === m.id && <Check className="size-5 text-accent" />}
        </button>
      ))}
      <div className="text-t3 text-[0.8rem] mt-3">A escolha vale só para esta faixa. A ordem geral fica em <button className="underline hover:text-t1" onClick={() => { close(); nav("settings/provider_order"); }}>Configurações › Ordem dos provedores</button>.</div>
    </Modal>
  );
}

function EditSong({ props, close }: P) {
  const t = getTrack(props.id)!;
  const [title, setTitle] = useState(t.title); const [artist, setArtist] = useState(artistOf(t));
  const err = !title.trim() ? "O título não pode ficar vazio." : !artist.trim() ? "O artista não pode ficar vazio." : "";
  return (
    <Modal title="Editar música" onClose={close} footer={<ConfirmFooter onCancel={close} onConfirm={() => { close(); toast("Alterações salvas (simulado)"); }} confirm="Salvar" disabled={!!err} />}>
      <Field label="Título"><TextField autoFocus value={title} onChange={setTitle} /></Field>
      <Field label="Artistas" hint={err || "Separe vários artistas com vírgula."}><TextField value={artist} onChange={setArtist} /></Field>
    </Modal>
  );
}
function EditArtist({ props, close }: P) {
  const a = getArtist(props.id)!; const [name, setName] = useState(a.name);
  return <Modal title="Editar artista" onClose={close} footer={<ConfirmFooter onCancel={close} onConfirm={() => { close(); toast("Alterações salvas (simulado)"); }} confirm="Salvar" disabled={!name.trim()} />}><Field label="Nome do artista" hint={!name.trim() ? "O nome não pode ficar vazio." : undefined}><TextField autoFocus value={name} onChange={setName} /></Field></Modal>;
}

function Details({ props, close }: P) {
  const t = getTrack(props.id)!;
  const count = useLib((s) => s.counts[t.id] ?? 0);
  const rows: [string, string][] = [["Título", t.title], ["Artista", artistOf(t)], ["Álbum", albumOf(t)], ["ID da mídia", `mm:${t.provider}:${t.id}`], ["Fonte", sourceName(t.provider)], ["Tipo MIME", t.format === "FLAC" ? "audio/flac" : t.format === "Opus" ? "audio/webm" : t.format === "MP3" ? "audio/mpeg" : "audio/mp4"], ["Codec", t.format.toLowerCase()], ["Taxa de bits", t.bitrate], ["Amostragem", t.sampleRate], ["Loudness", "−9,8 LUFS"], ["Volume aplicado", "−4,2 dB"], ["Tamanho", `${((t.duration * (t.format === "FLAC" ? 1000 : 160)) / 8000).toFixed(1).replace(".", ",")} MB`], ["Duração", fmtTime(t.duration)], ["Reproduções globais", fmtCount(t.plays)], ["Você ouviu", `${count} ${count === 1 ? "vez" : "vezes"}`]];
  return (
    <Modal title="Detalhes" width={520} onClose={close}>
      <div className="rounded-xl bg-s2 divide-y divide-line">{rows.map(([k, v]) => (
        <button key={k} title="Clique para copiar" onClick={() => { copyText(v); toast("Copiado"); }} className="w-full flex justify-between gap-6 px-4 min-h-10 py-2 items-center text-[0.88rem] hover:bg-s3 first:rounded-t-xl last:rounded-b-xl text-left"><span className="text-t3 shrink-0">{k}</span><span className="tnum truncate">{v}</span></button>
      ))}</div>
    </Modal>
  );
}

function Sleep({ close }: P) {
  const def = useSetting<number>("sleepDefault");
  const [min, setMin] = useState(def);
  const sleep = usePlayer((s) => s.sleep);
  const stopAfter = useSetting<boolean>("sleepStopAfterSong"), fade = useSetting<boolean>("sleepFadeOut");
  const left = sleep?.endsAt ? Math.max(0, Math.round((sleep.endsAt - Date.now()) / 60000)) : null;
  return (
    <Modal title="Timer de sono" subtitle={sleep ? (sleep.endOfSong ? "Ativo: para no fim desta música" : `Ativo: faltam cerca de ${left} min`) : "A música para sozinha depois do tempo escolhido"} onClose={close}
      footer={<>{sleep && <Btn variant="danger" onClick={() => { usePlayer.getState().setSleep(null); close(); toast("Timer de sono desativado"); }}>Desativar</Btn>}<div className="flex-1" /><Btn variant="ghost" onClick={() => { usePlayer.getState().setSleep({ endOfSong: true }); close(); toast("Timer de sono: para no fim desta música"); }}>Fim da música</Btn><Btn variant="primary" onClick={() => { usePlayer.getState().setSleep({ endsAt: Date.now() + min * 60000 }); close(); toast(`Timer de sono: ${min} minutos`); }}>Iniciar</Btn></>}>
      <div className="text-center my-3"><span className="text-[3.4rem] font-bold tnum tracking-tight">{min}</span><span className="text-t3 ml-2">minutos</span></div>
      <Range value={min} min={5} max={120} step={5} onChange={setMin} className="w-full thumb" />
      <div className="flex gap-2 justify-center mt-3 mb-5">{[15, 30, 45, 60, 90].map((m) => <button key={m} onClick={() => setMin(m)} className={cx("h-8 px-3 rounded-full text-[0.84rem] font-medium", min === m ? "bg-accent text-accent-fg" : "bg-s2 hover:bg-s3")}>{m} min</button>)}</div>
      <div className="rounded-xl bg-s2 divide-y divide-line">
        <div className="flex items-center gap-3 p-3.5"><div className="flex-1"><div className="font-medium">Esperar a música atual terminar</div></div><Switch on={stopAfter} onChange={(v) => setSetting("sleepStopAfterSong", v)} /></div>
        <div className="flex items-center gap-3 p-3.5"><div className="flex-1"><div className="font-medium">Diminuir o volume no último minuto</div></div><Switch on={fade} onChange={(v) => setSetting("sleepFadeOut", v)} /></div>
      </div>
      <button className="text-t3 hover:text-t1 text-[0.82rem] mt-3" onClick={() => { setSetting("sleepDefault", min); toast(`Padrão do timer de sono: ${min} minutos`); }}>Definir {min} min como padrão</button>
    </Modal>
  );
}

function Tempo({ close }: P) {
  const speed = usePlayer((s) => s.speed), pitch = usePlayer((s) => s.pitch);
  const vari = useSetting<boolean>("varispeed");
  const P = usePlayer.getState();
  const Stepper = ({ label, value, fmt, step, min, max, set }: { label: string; value: number; fmt: (v: number) => string; step: number; min: number; max: number; set: (v: number) => void }) => (
    <div className="mb-5"><div className="flex items-center mb-2"><span className="font-medium flex-1">{label}</span><IconBtn label="Diminuir" size={30} onClick={() => set(Math.max(min, +(value - step).toFixed(2)))}><Minus /></IconBtn><span className="w-16 text-center tnum font-semibold">{fmt(value)}</span><IconBtn label="Aumentar" size={30} onClick={() => set(Math.min(max, +(value + step).toFixed(2)))}><Plus /></IconBtn></div>
      <Range value={value} min={min} max={max} step={step} onChange={set} className="w-full thumb" /></div>
  );
  return (
    <Modal title="Velocidade e tom" onClose={close} footer={<><Btn variant="ghost" onClick={() => { P.setSpeed(1); P.setPitch(0); }}>Redefinir</Btn><Btn variant="primary" onClick={close}>Concluir</Btn></>}>
      <Stepper label="Velocidade" value={speed} fmt={(v) => `${v.toFixed(2).replace(".", ",")}×`} step={0.05} min={0.25} max={2} set={(v) => { P.setSpeed(v); if (vari) P.setPitch(+(12 * Math.log2(v)).toFixed(1)); }} />
      <div className="flex gap-2 -mt-2 mb-5">{[0.75, 1, 1.25, 1.5, 2].map((v) => <button key={v} onClick={() => P.setSpeed(v)} className={cx("h-7.5 px-3 rounded-full text-[0.82rem] font-medium tnum", speed === v ? "bg-accent text-accent-fg" : "bg-s2 hover:bg-s3")}>{String(v).replace(".", ",")}×</button>)}</div>
      <div className={cx(vari && "opacity-45 pointer-events-none")}><Stepper label="Tom" value={pitch} fmt={(v) => `${v > 0 ? "+" : ""}${String(v).replace(".", ",")} st`} step={0.5} min={-12} max={12} set={P.setPitch} /></div>
      <div className="flex items-center gap-3 p-3.5 rounded-xl bg-s2"><div className="flex-1"><div className="font-medium">Varispeed</div><div className="text-t3 text-[0.82rem]">Liga o tom à velocidade, como numa fita acelerada.</div></div><Switch on={vari} onChange={(v) => setSetting("varispeed", v)} /></div>
    </Modal>
  );
}

function CastDialog({ close }: P) {
  const [sel, setSel] = useState("this"); const [scan, setScan] = useState(true);
  useEffect(() => { const t = setTimeout(() => setScan(false), 1200); return () => clearTimeout(t); }, []);
  const devices: [string, string, ReactNode][] = [["this", "Este computador", <Monitor />], ["sala", "TV da sala", <Tv />], ["cozinha", "Caixa da cozinha", <Speaker />], ["quarto", "Chromecast do quarto", <Cast />]];
  return (
    <Modal title="Transmitir para dispositivo" subtitle="Google Cast e dispositivos na rede local" width={420} onClose={close}>
      {devices.slice(0, scan ? 1 : 4).map(([id, name, icon]) => (
        <button key={id} onClick={() => { setSel(id); if (id !== "this") toast(`Transmitindo para ${name}`); }} className={cx("w-full flex items-center gap-3.5 p-3.5 rounded-xl text-left [&>svg]:size-5", sel === id ? "bg-accent-soft text-accent" : "hover:bg-s2")}>{icon}<span className="flex-1 font-medium text-t1">{name}</span>{sel === id && <Check className="!size-5" />}</button>
      ))}
      {scan && <div className="flex items-center gap-3 p-3.5 text-t3"><Spinner className="size-5" />Procurando dispositivos…</div>}
    </Modal>
  );
}

function Mini({ close }: P) {
  const t = getTrack(usePlayer((s) => s.queue[s.index]));
  const playing = usePlayer((s) => s.playing);
  return (
    <Modal title="Mini-player" subtitle="Janela compacta com os controles essenciais" width={420} onClose={close} footer={<Btn variant="primary" onClick={async () => { close(); const open = await toggleMiniWindow(!!getSetting("miniOnTop")); toast(open ? "Mini-player aberto" : "Mini-player fechado"); }}>Abrir em janela</Btn>}>
      {t && <div className="relative rounded-2xl overflow-hidden p-4 flex items-center gap-4" style={{ boxShadow: "var(--shadow)" }}>
        <div className="absolute inset-0 blur-2xl scale-150 opacity-60" style={{ background: coverBg(t.hue, t.seed) }} /><div className="absolute inset-0 bg-black/50" />
        <Cover hue={t.hue} seed={t.seed} src={t.art} className="relative size-20 rounded-xl" />
        <div className="relative min-w-0 flex-1 text-white"><div className="font-semibold truncate">{t.title}</div><div className="text-white/70 text-[0.86rem] truncate">{artistOf(t)}</div>
          <div className="flex gap-1 mt-2 -ml-2"><Btn size="sm" variant="ghost" className="!text-white" onClick={() => usePlayer.getState().prev()}>Anterior</Btn><Btn size="sm" className="!bg-white !text-black" onClick={() => usePlayer.getState().toggle()}>{playing ? "Pausar" : "Tocar"}</Btn><Btn size="sm" variant="ghost" className="!text-white" onClick={() => usePlayer.getState().next()}>Próxima</Btn></div></div>
      </div>}
    </Modal>
  );
}

function Import({ close }: P) {
  const [step, setStep] = useState<"pick" | "csv" | "run">("pick");
  const [url, setUrl] = useState(""); const [header, setHeader] = useState(true); const [cols, setCols] = useState({ artist: "1", title: "0", url: "none" });
  const [pct, setPct] = useState(0);
  const run = (name: string) => { setStep("run"); let p = 0; const t = setInterval(() => { p += 9 + Math.random() * 14; setPct(Math.min(100, p)); if (p >= 100) { clearInterval(t); const id = useLib.getState().createPlaylist(name, sample(songs, 18, Date.now()).map((s) => s.id)); close(); toast("Playlist importada", { label: "Abrir", fn: () => nav(`playlist/${id}`) }); } }, 220); };
  const sampleRows = [["Título", "Artista", "Álbum", "URL"], ["Mar Azul", "Ravi Solano", "Deriva", "https://…"], ["Órbita", "Lume Aurora", "Vertigem", "https://…"], ["Lado B", "Os Satélites", "Contramão", ""]];
  const colOpts: [string, string][] = sampleRows[0].map((h, i) => [String(i), header ? h : `Coluna ${i + 1}`]);
  if (step === "run") return <Modal title="Importando playlist…" width={420} onClose={close}><div className="h-2 rounded-full bg-s3 overflow-hidden my-4"><div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} /></div><div className="text-t3 text-[0.86rem]">Procurando correspondências no catálogo… {Math.round(pct)}%</div></Modal>;
  if (step === "csv") return (
    <Modal title="Mapear colunas do CSV" subtitle="spotify-export.csv · 3 linhas de amostra" width={560} onClose={close} footer={<><Btn variant="ghost" onClick={() => setStep("pick")}>Voltar</Btn><Btn variant="primary" onClick={() => run("Importada do CSV")}>Continuar</Btn></>}>
      <div className="flex items-center gap-3 mb-4"><Checkbox on={header} onChange={setHeader} /><span>A primeira linha é o cabeçalho</span></div>
      <div className="rounded-xl bg-s2 overflow-hidden mb-5 text-[0.84rem]">{sampleRows.slice(header ? 0 : 1).map((r, i) => <div key={i} className={cx("grid grid-cols-4 gap-2 px-3 h-9 items-center", i === 0 && header ? "font-semibold bg-s3" : "border-t border-line text-t2")}>{r.map((c, k) => <span key={k} className="truncate">{c}</span>)}</div>)}</div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Título da música"><Select className="w-full" value={cols.title} onChange={(v) => setCols({ ...cols, title: v })} options={colOpts} /></Field>
        <Field label="Nome do artista"><Select className="w-full" value={cols.artist} onChange={(v) => setCols({ ...cols, artist: v })} options={colOpts} /></Field>
        <Field label="URL (opcional)"><Select className="w-full" value={cols.url} onChange={(v) => setCols({ ...cols, url: v })} options={[["none", "Nenhuma"], ...colOpts]} /></Field>
      </div>
    </Modal>
  );
  return (
    <Modal title="Importar playlist" subtitle="Traga suas playlists de outros serviços ou de arquivos" width={520} onClose={close}>
      <Field label="Link de playlist" hint="YouTube Music, Spotify, TIDAL, Deezer ou SoundCloud">
        <div className="flex gap-2"><TextField className="flex-1" value={url} onChange={setUrl} placeholder="https://…" icon={<Link />} onEnter={() => url && run("Importada do link")} /><Btn variant="primary" disabled={!url.trim()} onClick={() => run("Importada do link")}>Importar</Btn></div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => run("Importada do M3U")} className="p-4 rounded-xl bg-s2 hover:bg-s3 text-left transition-colors"><FileText className="size-6 text-accent mb-2" /><div className="font-semibold">Arquivo M3U</div><div className="text-t3 text-[0.82rem]">Playlists exportadas de outros players.</div></button>
        <button onClick={() => setStep("csv")} className="p-4 rounded-xl bg-s2 hover:bg-s3 text-left transition-colors"><FileSpreadsheet className="size-6 text-accent mb-2" /><div className="font-semibold">Arquivo CSV</div><div className="text-t3 text-[0.82rem]">Exportações do Spotify, Apple Music e similares.</div></button>
      </div>
      <div className="text-t3 text-[0.8rem] mt-4">Nesta prévia a importação é simulada com músicas do catálogo de demonstração.</div>
    </Modal>
  );
}

export const SHORTCUTS: [string, [string, string][]][] = [
  ["Reprodução", [["Espaço", "Tocar / pausar"], ["Ctrl →", "Próxima música"], ["Ctrl ←", "Música anterior"], ["→ / ←", "Avançar / voltar 5 s"], ["↑ / ↓", "Volume"], ["M", "Silenciar"], ["S", "Aleatório"], ["R", "Repetir"], ["L", "Curtir a música atual"]]],
  ["Navegação", [["Ctrl K", "Paleta de comandos"], ["Ctrl F", "Buscar"], ["Alt ← / →", "Voltar / avançar"], ["Ctrl B", "Barra lateral"], ["Ctrl ,", "Configurações"], ["F", "Tocando agora"], ["Q", "Fila"], ["Y", "Letra"], ["Esc", "Fechar o que estiver aberto"]]],
  ["Listas", [["Enter / clique duplo", "Tocar"], ["Ctrl + clique", "Selecionar várias"], ["Shift + clique", "Selecionar intervalo"], ["Clique direito", "Menu de opções"], ["Arrastar", "Adicionar à playlist ou reordenar"]]],
];
function Shortcuts({ close }: P) {
  return (
    <Modal title="Atalhos de teclado" width={640} onClose={close}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">{SHORTCUTS.map(([g, rows]) => (
        <div key={g} className={g === "Listas" ? "col-span-2" : ""}><div className="text-[0.72rem] font-semibold uppercase tracking-wider text-t3 mb-2">{g}</div>
          <div className={g === "Listas" ? "grid grid-cols-2 gap-x-8" : ""}>{rows.map(([k, l]) => <div key={k} className="flex items-center justify-between h-9 border-b border-line last:border-0"><span className="text-t2">{l}</span><span className="flex gap-1">{k.split(" ").map((p, i) => (p === "/" || p === "+" ? <span key={i} className="text-t3">{p}</span> : <Kbd key={i}>{p}</Kbd>))}</span></div>)}</div></div>
      ))}</div>
    </Modal>
  );
}

const SERVICES: Record<string, { name: string; hue: number; token: string; hint: string }> = {
  youtube: { name: "YouTube Music", hue: 25, token: "Token de login", hint: "Método avançado: em vez do portal web, cole o token de login diretamente." },
  spotify: { name: "Spotify", hue: 150, token: "Cookies / sp_dc + sp_t", hint: "Cole o cabeçalho de cookies completo para o início personalizado. O Canvas funciona só com sp_dc." },
  tidal: { name: "TIDAL", hue: 220, token: "Cookies ou token", hint: "Cole o cabeçalho de cookies, um refresh token ou um access token." },
  deezer: { name: "Deezer", hue: 300, token: "Cookie (arl)", hint: "Cole o valor de arl, sid ou um cabeçalho de cookies do Deezer." },
  soundcloud: { name: "SoundCloud", hue: 50, token: "Token OAuth", hint: "Cole o oauth_token da sua sessão no navegador." },
  lastfm: { name: "Last.fm", hue: 10, token: "Senha", hint: "" },
  discord: { name: "Discord", hue: 265, token: "", hint: "" },
};
function YtLogin({ close }: P) {
  const { status, error, info } = useYt();
  const [mode, setMode] = useState<"web" | "cookie">("web"); const [cookie, setCookie] = useState("");
  useEffect(() => { if (info) close(); }, [info]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = status !== "idle";
  return (
    <Modal title="Entrar no YouTube Music" width={460} onClose={() => { if (status === "waiting") cancelLogin(); close(); }}>
      <div className="flex justify-center mb-5"><BrandTile id="youtube" size={64} className="rounded-2xl" /></div>
      <div className="flex justify-center mb-5"><div className="inline-flex p-1 rounded-full bg-s2">{(["web", "cookie"] as const).map((m) => <button key={m} onClick={() => !busy && setMode(m)} className={cx("h-8 px-4 rounded-full text-[0.86rem] font-medium", mode === m ? "bg-accent text-accent-fg" : "text-t2")}>{m === "web" ? "Login pela web" : "Colar cookie"}</button>)}</div></div>
      {status === "waiting" ? (
        <div className="grid place-items-center gap-3 text-t2 py-4 text-center"><Spinner className="size-7" /><div>Termine o login na janela do Google que abriu.<br /><span className="text-t3 text-[0.86rem]">Ela fecha sozinha quando a conta for reconhecida.</span></div><Btn variant="ghost" onClick={cancelLogin}>Cancelar</Btn></div>
      ) : status === "checking" ? <div className="grid place-items-center h-36 gap-3 text-t2"><Spinner className="size-7" />Verificando a sessão…</div>
      : mode === "web" ? (<><p className="text-t2 text-center mb-5">Uma janela do Google vai abrir para você entrar. O MetroMusic guarda só a sessão necessária, neste computador, e não a senha.</p><Btn variant="primary" className="w-full" icon={<LogIn />} onClick={loginWeb}>Continuar no Google</Btn></>)
      : (<><Field label="Cabeçalho Cookie" hint="Abra music.youtube.com já logado, F12 › Rede, clique numa requisição para music.youtube.com e copie o valor do cabeçalho “Cookie”. Ele precisa ter o SAPISID."><TextField multiline value={cookie} onChange={setCookie} placeholder="Cole aqui" /></Field><Btn variant="primary" className="w-full" disabled={!cookie.trim()} onClick={() => loginCookie(cookie)}>Salvar e conectar</Btn></>)}
      {error && <p className="mt-4 text-[0.86rem] text-danger text-center">{error}</p>}
      {mode === "web" && status === "idle" && error && <p className="mt-2 text-t3 text-[0.8rem] text-center">Se o Google recusar o login nesta janela, use “Colar cookie”.</p>}
    </Modal>
  );
}
function SpLogin({ close }: P) {
  const { status, error, info } = useSp();
  const [mode, setMode] = useState<"web" | "cookie">("web"); const [dc, setDc] = useState("");
  useEffect(() => { if (info) close(); }, [info]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = status === "waiting";
  return (
    <Modal title="Entrar no Spotify" width={470} onClose={() => { if (waiting) cancelSpLogin(); close(); }}>
      <div className="flex justify-center mb-5"><BrandTile id="spotify" size={64} className="rounded-2xl" /></div>
      <div className="flex justify-center mb-5"><div className="inline-flex p-1 rounded-full bg-s2">{(["web", "cookie"] as const).map((m) => <button key={m} onClick={() => !waiting && setMode(m)} className={cx("h-8 px-4 rounded-full text-[0.86rem] font-medium", mode === m ? "bg-accent text-accent-fg" : "text-t2")}>{m === "web" ? "Login pela web" : "Colar cookie sp_dc"}</button>)}</div></div>
      {waiting ? (
        <div className="grid place-items-center gap-3 text-t2 py-4 text-center"><Spinner className="size-7" /><div>Termine o login na janela do Spotify, se ela estiver aberta.<br /><span className="text-t3 text-[0.86rem]">Ela fecha sozinha quando a conta for reconhecida.</span></div><Btn variant="ghost" onClick={cancelSpLogin}>Cancelar</Btn></div>
      ) : mode === "web" ? (<>
        <p className="text-t2 text-center mb-5">Uma janela do Spotify vai abrir para você entrar. O MetroMusic guarda só o cookie da sessão, neste computador, e não a senha.</p>
        <Btn variant="primary" className="w-full" icon={<LogIn />} onClick={loginSp}>Continuar no Spotify</Btn>
      </>) : (<>
        <Field label="Cookie sp_dc" hint="Em open.spotify.com já logado, abra o F12 › Aplicativo › Cookies e copie o valor do cookie sp_dc."><TextField multiline value={dc} onChange={setDc} placeholder="AQ…" /></Field>
        <Btn variant="primary" className="w-full" disabled={!dc.trim()} onClick={() => loginSpCookie(dc)}>Salvar e conectar</Btn>
      </>)}
      {error && <p className="mt-4 text-[0.86rem] text-danger text-center">{error}</p>}
      <p className="text-t3 text-[0.8rem] mt-4 text-center">As músicas tocam pelo YouTube Music ou SoundCloud: o áudio do Spotify é protegido. O login usa um método não oficial e pode parar de funcionar se o Spotify mudar.</p>
    </Modal>
  );
}
function ScLogin({ close }: P) {
  const { status, error, info } = useSc();
  const [mode, setMode] = useState<"web" | "token">("web"); const [token, setToken] = useState("");
  useEffect(() => { if (info) close(); }, [info]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = status !== "idle";
  return (
    <Modal title="Entrar no SoundCloud" width={460} onClose={() => { if (status === "waiting") cancelScLogin(); close(); }}>
      <div className="flex justify-center mb-5"><BrandTile id="soundcloud" size={64} className="rounded-2xl" /></div>
      <div className="flex justify-center mb-5"><div className="inline-flex p-1 rounded-full bg-s2">{(["web", "token"] as const).map((m) => <button key={m} onClick={() => !busy && setMode(m)} className={cx("h-8 px-4 rounded-full text-[0.86rem] font-medium", mode === m ? "bg-accent text-accent-fg" : "text-t2")}>{m === "web" ? "Login pela web" : "Colar token"}</button>)}</div></div>
      {status === "waiting" ? (
        <div className="grid place-items-center gap-3 text-t2 py-4 text-center"><Spinner className="size-7" /><div>Termine o login na janela do SoundCloud que abriu.<br /><span className="text-t3 text-[0.86rem]">Ela fecha sozinha quando a conta for reconhecida.</span></div><Btn variant="ghost" onClick={cancelScLogin}>Cancelar</Btn></div>
      ) : status === "checking" ? <div className="grid place-items-center h-36 gap-3 text-t2"><Spinner className="size-7" />Verificando a sessão…</div>
      : mode === "web" ? (<><p className="text-t2 text-center mb-3">Uma janela do SoundCloud vai abrir para você entrar. O MetroMusic guarda só a sessão, neste computador.</p><p className="text-t3 text-[0.82rem] text-center mb-5">Se você entra com Google, Facebook ou Apple, o SoundCloud pode recusar a janela: use “Colar token”.</p><Btn variant="primary" className="w-full" icon={<LogIn />} onClick={loginScWeb}>Continuar no SoundCloud</Btn></>)
      : (<><Field label="Token OAuth" hint="Em soundcloud.com já logado, abra o F12 › Aplicativo › Cookies e copie o valor do cookie oauth_token."><TextField multiline value={token} onChange={setToken} placeholder="2-123456-…" /></Field><Btn variant="primary" className="w-full" disabled={!token.trim()} onClick={() => loginScToken(token)}>Salvar e conectar</Btn></>)}
      {error && <p className="mt-4 text-[0.86rem] text-danger text-center">{error}</p>}
    </Modal>
  );
}
function LastfmLogin({ close }: P) {
  const { hasKeys, busy, error } = useLastfm();
  const [user, setUser] = useState(""); const [pass, setPass] = useState(""); const [key, setKey] = useState(""); const [secret, setSecret] = useState("");
  const needKeys = !hasKeys;
  const go = () => loginLastfm(user.trim(), pass, key, secret);
  const ready = user.trim() && pass && (!needKeys || (key.trim() && secret.trim()));
  return (
    <Modal title="Entrar no Last.fm" width={460} onClose={close}>
      <div className="flex justify-center mb-5"><BrandTile id="lastfm" size={64} className="rounded-2xl" /></div>
      {busy ? <div className="grid place-items-center h-36 gap-3 text-t2"><Spinner className="size-7" />Entrando…</div> : (<>
        {needKeys && <><p className="text-t2 text-[0.88rem] mb-3">O Last.fm exige uma chave de API para cada app. Crie a sua (grátis) em <b>last.fm/api/account/create</b> e cole abaixo. Isso é pedido só uma vez.</p>
          <Field label="Chave da API"><TextField value={key} onChange={setKey} /></Field><Field label="Segredo compartilhado"><TextField secret value={secret} onChange={setSecret} /></Field></>}
        <Field label="Usuário"><TextField autoFocus={!needKeys} value={user} onChange={setUser} /></Field>
        <Field label="Senha" hint="A senha é enviada só ao Last.fm para abrir a sessão e não fica guardada."><TextField secret value={pass} onChange={setPass} onEnter={() => ready && go()} /></Field>
        {error && <p className="mb-3 text-[0.86rem] text-danger">{error}</p>}
        <Btn variant="primary" className="w-full" disabled={!ready} onClick={go}>Entrar</Btn>
      </>)}
    </Modal>
  );
}
function Login(p: P) {
  if (p.props.service === "youtube" && isTauri) return <YtLogin {...p} />;
  if (p.props.service === "lastfm" && isTauri) return <LastfmLogin {...p} />;
  if (p.props.service === "soundcloud" && isTauri) return <ScLogin {...p} />;
  if (p.props.service === "spotify" && isTauri) return <SpLogin {...p} />;
  return <LoginMock {...p} />;
}
function LoginMock({ props, close }: P) {
  const sv = SERVICES[props.service] ?? SERVICES.youtube;
  const [mode, setMode] = useState<"web" | "token">("web"); const [user, setUser] = useState(""); const [token, setToken] = useState(""); const [busy, setBusy] = useState(false);
  const done = () => { setBusy(true); setTimeout(() => { useLib.getState().setAccount(props.service, user.trim() || "cadu"); close(); toast(`Conectado ao ${sv.name}`); }, 1100); };
  return (
    <Modal title={`Entrar no ${sv.name}`} width={440} onClose={close}>
      <div className="flex justify-center mb-5"><BrandTile id={(props.service in SERVICES ? props.service : "youtube") as BrandId} size={64} className="rounded-2xl" /></div>
      {sv.token && props.service !== "lastfm" && <div className="flex justify-center mb-5"><div className="inline-flex p-1 rounded-full bg-s2">{(["web", "token"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cx("h-8 px-4 rounded-full text-[0.86rem] font-medium", mode === m ? "bg-accent text-accent-fg" : "text-t2")}>{m === "web" ? "Login pela web" : "Token / cookie"}</button>)}</div></div>}
      {busy ? <div className="grid place-items-center h-36 gap-3 text-t2"><Spinner className="size-7" />Entrando…</div>
        : props.service === "lastfm" ? (<><Field label="Usuário"><TextField autoFocus value={user} onChange={setUser} /></Field><Field label="Senha"><TextField secret value={token} onChange={setToken} onEnter={done} /></Field><Btn variant="primary" className="w-full" disabled={!user || !token} onClick={done}>Entrar</Btn></>)
        : mode === "web" || !sv.token ? (<><p className="text-t2 text-center mb-5">Uma janela do {sv.name} vai abrir para você entrar com a sua conta. O MetroMusic guarda só a sessão necessária, neste computador.</p><Btn variant="primary" className="w-full" icon={<LogIn />} onClick={done}>Continuar no {sv.name}</Btn></>)
        : (<><Field label={sv.token} hint={sv.hint}><TextField multiline value={token} onChange={setToken} placeholder="Cole aqui" /></Field><Btn variant="primary" className="w-full" disabled={!token.trim()} onClick={done}>Salvar e conectar</Btn></>)}
    </Modal>
  );
}
function Logout({ close }: P) {
  const out = (clear: boolean) => { close(); if (isTauri) logout(clear); else { useLib.getState().setAccount("youtube", null); if (clear) useLib.setState({ savedPlaylists: [] }); toast("Você saiu da conta"); } };
  return <Modal title="Manter os dados da biblioteca?" width={440} onClose={close} footer={<><Btn variant="ghost" onClick={close}>Cancelar</Btn><Btn variant="danger" onClick={() => out(true)}>Limpar</Btn><Btn variant="primary" onClick={() => out(false)}>Manter</Btn></>}><p className="text-t2 leading-relaxed">Quer manter as playlists e os dados da biblioteca neste computador? As músicas baixadas sempre ficam.</p></Modal>;
}

function LyricsSearch({ props, close }: P) {
  const t = getTrack(props.id)!;
  const [title, setTitle] = useState(t.title); const [artist, setArtist] = useState(artistOf(t)); const [state, setState] = useState<"form" | "loading" | "results">("form");
  const results = ["BetterLyrics", "Apple Music", "LrcLib", "Musixmatch", "Deezer"].map((p, i) => ({ p, sync: ["Sílaba a sílaba", "Palavra a palavra", "Linha a linha", "Linha a linha", "Palavra a palavra"][i], dur: fmtTime(t.duration + [0, 0, 1, -2, 0][i]) }));
  return (
    <Modal title="Buscar letra" width={480} onClose={close} footer={state === "form" ? <><Btn variant="ghost" onClick={() => toast("Abrindo a busca no navegador…")}>Buscar na web</Btn><div className="flex-1" /><Btn variant="primary" icon={<Search />} onClick={() => { setState("loading"); setTimeout(() => setState("results"), 900); }}>Buscar</Btn></> : undefined}>
      {state === "form" && <><Field label="Título"><TextField autoFocus value={title} onChange={setTitle} /></Field><Field label="Artistas"><TextField value={artist} onChange={setArtist} /></Field></>}
      {state === "loading" && <div className="grid place-items-center h-40 text-t3"><Spinner className="size-6" /></div>}
      {state === "results" && results.map((r) => <button key={r.p} onClick={() => { close(); toast(`Letra de ${r.p} aplicada`); }} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-s2 text-left"><div className="flex-1"><div className="font-medium">{r.p}</div><div className="text-t3 text-[0.82rem]">{r.sync} · {r.dur}</div></div><Btn size="sm">Usar</Btn></button>)}
    </Modal>
  );
}
function LyricsEdit({ props, close }: P) {
  const t = getTrack(props.id)!; const ly = getLyrics(t);
  const [text, setText] = useState(ly?.lines.map((l) => `[${fmtTime(l.t).padStart(5, "0")}.00] ${l.text}`).join("\n") ?? "");
  return <Modal title="Editar letra" subtitle="Formato LRC: [mm:ss.xx] texto da linha" width={620} onClose={close} footer={<ConfirmFooter onCancel={close} onConfirm={() => { close(); toast("Letra salva (simulado)"); }} confirm="Salvar" />}><textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="w-full h-[46vh] rounded-xl bg-s2 p-4 font-mono text-[0.84rem] leading-relaxed resize-none focus:bg-bg border border-transparent focus:border-accent/50" /></Modal>;
}
function LyricsOffset({ props, close }: P) {
  const off = useLyr((s) => s.offset[props.id] ?? 0);
  const set = (v: number) => useLyr.getState().setOffset(props.id, +v.toFixed(2));
  return (
    <Modal title="Ajustar sincronia da letra" subtitle="Use se a letra estiver adiantada ou atrasada" width={420} onClose={close} footer={<><Btn variant="ghost" onClick={() => set(0)}>Zerar</Btn><Btn variant="primary" onClick={close}>Concluir</Btn></>}>
      <div className="flex items-center justify-center gap-4 my-4"><IconBtn label="Atrasar 0,1 s" onClick={() => set(off - 0.1)} className="bg-s2"><Minus /></IconBtn><span className="text-[2.2rem] font-bold tnum w-40 text-center">{off > 0 ? "+" : ""}{off.toFixed(1).replace(".", ",")} s</span><IconBtn label="Adiantar 0,1 s" onClick={() => set(off + 0.1)} className="bg-s2"><Plus /></IconBtn></div>
      <Range value={off} min={-5} max={5} step={0.1} onChange={set} className="w-full thumb" />
      <div className="flex justify-between text-t3 text-[0.78rem] mt-1"><span>Letra mais tarde</span><span>Letra mais cedo</span></div>
    </Modal>
  );
}
function LyricsImage({ props, close }: P) {
  const t = getTrack(props.id)!; const ly = getLyrics(t);
  const pos = usePlayer.getState().position;
  const start = Math.max(0, (ly?.lines.findIndex((l) => l.end > pos) ?? 0));
  const [from, setFrom] = useState(start); const [n, setN] = useState(3); const [style, setStyle] = useState("cover"); const [busy, setBusy] = useState(false);
  const lines = ly?.lines.slice(from, from + n) ?? [];
  const bg = style === "cover" ? coverBg(t.hue, t.seed) : style === "dark" ? "oklch(0.18 0.02 280)" : `linear-gradient(140deg, oklch(0.6 0.17 ${t.hue}), oklch(0.35 0.13 ${(t.hue + 50) % 360}))`;
  return (
    <Modal title="Compartilhar letra como imagem" width={560} onClose={close} footer={<><Btn variant="ghost" icon={<Copy />} onClick={() => { close(); toast("Imagem copiada"); }}>Copiar</Btn><Btn variant="primary" icon={busy ? <Spinner /> : <Download />} disabled={busy} onClick={() => { setBusy(true); setTimeout(() => { close(); toast("Imagem salva em Imagens"); }, 900); }}>{busy ? "Gerando imagem…" : "Salvar imagem"}</Btn></>}>
      <div className="flex gap-5">
        <div className="relative w-64 aspect-[4/5] rounded-2xl overflow-hidden shrink-0 p-5 flex flex-col text-white" style={{ background: bg }}>
          {style === "cover" && <div className="absolute inset-0 bg-black/45 backdrop-blur-xl" />}
          <div className="relative flex items-center gap-2.5 mb-auto"><Cover hue={t.hue} seed={t.seed} src={t.art} className="size-10 rounded-md" /><div className="min-w-0"><div className="font-semibold truncate text-[0.9rem]">{t.title}</div><div className="text-white/70 truncate text-[0.78rem]">{artistOf(t)}</div></div></div>
          <div className="relative text-[1.25rem] font-bold leading-tight tracking-tight space-y-1.5">{lines.map((l, i) => <div key={i}>{l.text}</div>)}</div>
          <div className="relative mt-4 text-white/60 text-[0.7rem] font-semibold tracking-wider flex items-center gap-1.5"><AudioLines className="size-3.5" />METROMUSIC</div>
        </div>
        <div className="flex-1 min-w-0">
          <Field label="Primeira linha"><div className="flex items-center gap-2"><IconBtn label="Linha anterior" size={30} className="bg-s2" onClick={() => setFrom(Math.max(0, from - 1))}><Minus /></IconBtn><span className="flex-1 text-center tnum">{from + 1}ª linha</span><IconBtn label="Próxima linha" size={30} className="bg-s2" onClick={() => setFrom(Math.min((ly?.lines.length ?? 1) - 1, from + 1))}><Plus /></IconBtn></div></Field>
          <Field label={`Quantidade de linhas: ${n}`}><Range value={n} min={1} max={6} step={1} onChange={setN} className="w-full thumb" /></Field>
          <Field label="Fundo"><Select className="w-full" value={style} onChange={setStyle} options={[["cover", "Capa desfocada"], ["gradient", "Gradiente"], ["dark", "Escuro"]]} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function SongPicker({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState(""); const counts = useLib((s) => s.counts);
  const t = getTrack(value);
  const list = songs.filter((s) => counts[s.id] && norm(`${s.title} ${artistOf(s)}`).includes(norm(q)));
  return (
    <Field label={label}>
      {t ? <div className="flex items-center gap-3 p-2.5 rounded-xl bg-s2"><Cover hue={t.hue} seed={t.seed} src={t.art} className="size-10 rounded-md" /><div className="min-w-0 flex-1"><div className="truncate font-medium">{t.title}</div><div className="text-t3 text-[0.8rem] truncate">{artistOf(t)} · tempo de escuta: {fmtTime((counts[t.id] ?? 0) * t.duration)}</div></div><Btn size="sm" variant="ghost" onClick={() => onChange("")}>Trocar</Btn></div>
        : <><TextField value={q} onChange={setQ} placeholder="Digite para buscar" icon={<Search />} />
          {q && <div className="mt-1.5 rounded-xl bg-s2 max-h-40 overflow-y-auto">{list.slice(0, 6).map((s) => <button key={s.id} onClick={() => onChange(s.id)} className="w-full text-left px-3 h-9 hover:bg-s3 truncate text-[0.88rem]">{s.title} <span className="text-t3">· {artistOf(s)}</span></button>)}{list.length > 6 && <div className="px-3 py-2 text-t3 text-[0.78rem]">Continue digitando para refinar (mais {list.length - 6})</div>}</div>}</>}
    </Field>
  );
}
function TimeTransfer({ close }: P) {
  const [a, setA] = useState(""); const [b, setB] = useState("");
  return (
    <Modal title="Transferência de tempo" width={500} onClose={close} footer={<ConfirmFooter onCancel={close} onConfirm={() => { close(); toast("Tempo de escuta transferido"); }} confirm="Converter" disabled={!a || !b || a === b} />}>
      <div className="p-3.5 rounded-xl bg-warn/12 text-warn text-[0.86rem] mb-5">Esta ação não pode ser desfeita. Faça um backup antes. Só aparecem músicas com pelo menos uma reprodução registrada.</div>
      <SongPicker label="Música de origem" value={a} onChange={setA} /><SongPicker label="Música de destino" value={b} onChange={setB} />
    </Modal>
  );
}

function Update({ close }: P) {
  const [state, setState] = useState<"ask" | "down" | "ready">("ask"); const [pct, setPct] = useState(0);
  useEffect(() => { if (state !== "down") return; const t = setInterval(() => setPct((p) => { if (p >= 100) { clearInterval(t); setState("ready"); return 100; } return p + 4; }), 120); return () => clearInterval(t); }, [state]);
  return (
    <Modal title="Atualização disponível" subtitle="MetroMusic 0.2.0 está disponível" width={460} onClose={close} footer={state === "ask" ? <><Btn variant="ghost" onClick={close}>Agora não</Btn><Btn variant="primary" icon={<Download />} onClick={() => setState("down")}>Atualizar</Btn></> : state === "ready" ? <Btn variant="primary" onClick={() => { close(); toast("O app reinicia para concluir a instalação (simulado)"); }}>Instalar e reiniciar</Btn> : undefined}>
      {state === "ask" ? <ul className="text-t2 space-y-1.5 list-disc pl-5"><li>Mini-player em janela própria</li><li>Crossfade mais suave entre faixas de taxas diferentes</li><li>Correções na sincronia das letras</li></ul>
        : <><div className="h-2 rounded-full bg-s3 overflow-hidden my-3"><div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div><div className="flex justify-between text-t3 text-[0.82rem] tnum"><span>{(pct * 0.38).toFixed(1).replace(".", ",")} MB de 38,0 MB</span><span>{state === "ready" ? "Pronto para instalar" : "4,2 MB/s"}</span></div></>}
    </Modal>
  );
}

const MAP: Record<string, (p: P) => ReactNode> = {
  createPlaylist: CreatePlaylist, editPlaylist: EditPlaylist, editCover: EditCover, duplicates: Duplicates, confirm: Confirm, share: Share, source: Source, editSong: EditSong, editArtist: EditArtist,
  details: Details, sleep: Sleep, tempo: Tempo, cast: CastDialog, mini: Mini, import: Import, shortcuts: Shortcuts, login: Login, logout: Logout,
  lyricsSearch: LyricsSearch, lyricsEdit: LyricsEdit, lyricsOffset: LyricsOffset, lyricsImage: LyricsImage, timeTransfer: TimeTransfer, update: Update,
};
export function Dialogs() {
  const dialog = useUI((s) => s.dialog), close = useUI((s) => s.closeDialog);
  const C = dialog ? MAP[dialog.type] : null;
  return <AnimatePresence>{dialog && C && <C key={dialog.type + JSON.stringify(dialog.props?.id ?? "")} props={dialog.props} close={close} />}</AnimatePresence>;
}
export { getSetting };
