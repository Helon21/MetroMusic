import { isTauri } from "../lib/native";
import { logoutLastfm } from "../lib/lastfm";
import { logoutSc } from "../lib/soundcloud";
import { logoutSp } from "../lib/spotify";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { AlarmClock, AudioLines, Bell, Check, ChevronRight, CircleUser, Database, Download, FlaskConical, FolderOpen, FolderPlus, Gauge, Globe, GripVertical, HardDrive, HeartPulse, Info, Languages, ListOrdered, Monitor, Moon, Music, Palette, Plug, Plus, RefreshCw, Search, Shield, Sun, SunMoon, Trash2, TriangleAlert, X, Code, Scale, ScrollText, Users } from "lucide-react";
import { artistOf, SOURCES } from "../lib/catalog";
import { AUDIO_PROVIDERS, DEFAULTS, PAGES, PALETTES, UNAVAILABLE_PROVIDERS, type Item, type Page } from "../lib/settingsSchema";
import { useT } from "../i18n";
import { useDiscord } from "../lib/discord";
import { addFolder, removeFolder, scanLocal } from "../lib/local";
import { deleteAllDownloads } from "../lib/downloads";
import { forgetImages } from "../lib/imageCache";
import { checkUpdates, currentVersion, useUpdate } from "../lib/updater";
import { usePerf } from "../lib/perf";
import { applyBackup, createBackup, readBackup } from "../lib/backupIO";
import { describeNext } from "../lib/schedule";
import { BrandIcon, BrandTile, isBrand, lyricsBrand, SourceIcon } from "../lib/brands";
import { backend, engine } from "../lib/engine";
import { invoke } from "../lib/native";
import { iconFor } from "../lib/settingsIcons";
import { cx, norm } from "../lib/util";
import { SHORTCUTS } from "../components/Dialogs";
import { resolvePlaylist, useLib } from "../store/library";
import { useCurrent, usePlayer } from "../store/player";
import { setSetting, useSetting, useSettings } from "../store/settings";
import { nav, openDialog, toast, useUI } from "../store/ui";
import { Badge, Btn, Cover, IconBtn, Kbd, Range, Select, Spinner, Switch, TextField } from "../components/ui";
import { useLT } from "./Tools";

const ICONS: Record<string, ReactNode> = {
  appearance: <Palette />, desktop: <Monitor />, experiments: <FlaskConical />, player: <AudioLines />, provider_order: <ListOrdered />, provider_health: <HeartPulse />, content: <Globe />, local: <FolderOpen />,
  integrations: <Plug />, privacy: <Shield />, storage: <HardDrive />, backup: <Database />, updater: <Download />, about: <Info />,
};

// ───────── Ações disparadas por botões do esquema
function runAction(id: string) {
  const L = useLib.getState();
  const confirm = (title: string, text: string, action: () => void, label = "Limpar") => openDialog("confirm", { title, text, confirm: label, danger: true, action });
  switch (id) {
    case "simulateError": usePlayer.getState().setError("Nenhuma fonte respondeu (YouTube Music: sem stream · SoundCloud: tempo esgotado).", { manual: true }); return toast("Erro simulado: veja a barra do player");
    case "simulateCrash": return void useUI.setState({ crash: "MetroMusic 0.1.0 (build 2026-11-09)\nSistema: Linux 7.3 · WebKitGTK 2.54\n\nTypeError: Cannot read properties of undefined (reading 'duration')\n    at PlayerBar (player.tsx:142)\n    at renderWithHooks (react-dom.development.js:15486)\n\n(travamento simulado para demonstração)" });
    case "resetProviderOrder": useSettings.getState().reset("providerOrder"); useSettings.getState().reset("providerOff"); return toast("Ordem dos provedores restaurada");
    case "resetAiPrompt": useSettings.getState().reset("aiPrompt"); return toast("Prompt padrão restaurado");
    case "scanLocal": return void scanLocal();
    case "clearHistory": return confirm("Limpar o histórico de escuta?", "Tem certeza de que quer apagar todo o histórico de escuta?", () => { L.clear("history"); toast("Histórico de escuta limpo"); });
    case "clearSearchHistory": return confirm("Limpar o histórico de busca?", "Tem certeza de que quer apagar todo o histórico de busca?", () => { L.clear("searchHistory"); toast("Histórico de busca limpo"); });
    case "clearDownloads": return confirm("Apagar todos os downloads?", "As músicas baixadas deixam de estar disponíveis offline.", () => { if (isTauri) deleteAllDownloads(); else L.clear("downloads"); toast("Downloads apagados"); }, "Apagar");
    case "clearSongCache": return confirm("Limpar o cache de músicas?", "Tem certeza de que quer apagar todas as músicas em cache?", () => { L.clear("cached"); engine.cacheClear(); toast("Cache de músicas limpo"); });
    case "clearImageCache": return confirm("Limpar o cache de imagens?", "As capas serão baixadas de novo quando necessário.", () => { forgetImages(); (engine.imageClear() ?? Promise.resolve()).then(() => toast("Cache de imagens limpo")).catch((e) => toast(`Não consegui limpar: ${e}`)); });
    case "backup": return void createBackup().then((p) => p && toast(`Backup salvo em ${p}`)).catch((e) => toast(`Não consegui criar o backup: ${e?.message ?? e}`));
    case "restore": return void readBackup().then((r) => r && openDialog("confirm", { title: "Restaurar backup?", text: `Playlists, curtidas, histórico e configurações atuais serão substituídos pelos do arquivo (${r.data.createdAt.slice(0, 10) || "sem data"}). Suas contas continuam conectadas.`, confirm: "Restaurar", action: () => { applyBackup(r.data); toast("Backup restaurado"); } })).catch((e) => toast(e?.message ?? String(e)));
    case "importM3u": case "importCsv": return openDialog("import");
    case "timeTransfer": return openDialog("timeTransfer");
  }
}

// ───────── Blocos personalizados
function ThemeMode() {
  const mode = useSetting<string>("themeMode");
  const opts: [string, string, ReactNode][] = [["light", "Claro", <Sun />], ["dark", "Escuro", <Moon />], ["system", "Sistema", <SunMoon />]];
  return (
    <div className="p-4"><div className="font-medium mb-3">Modo do tema</div>
      <div className="grid grid-cols-3 gap-3">{opts.map(([v, l, icon]) => (
        <button key={v} onClick={() => setSetting("themeMode", v)} className={cx("relative rounded-xl p-3 text-left border-2 transition-colors", mode === v ? "border-accent bg-accent-soft" : "border-transparent bg-s2 hover:bg-s3")}>
          <div className="h-16 rounded-lg mb-3 overflow-hidden flex" style={{ background: v === "light" ? "#f4f3f7" : v === "dark" ? "#17161c" : "linear-gradient(105deg, #f4f3f7 50%, #17161c 50%)" }}><div className="w-1/4 h-full" style={{ background: v === "light" ? "#e6e4ec" : "#ffffff14" }} /><div className="flex-1 p-2 space-y-1.5"><div className="h-2 w-3/4 rounded-full bg-accent" /><div className="h-2 w-1/2 rounded-full" style={{ background: v === "light" ? "#0002" : "#fff3" }} /></div></div>
          <div className="flex items-center gap-2 font-medium [&>svg]:size-4">{icon}{l}{mode === v && <Check className="ml-auto text-accent" />}</div>
        </button>))}</div></div>
  );
}
function PalettePicker() {
  const cur = useSetting<string>("palette"); const t = useCurrent();
  return (
    <div className="p-4"><div className="font-medium">Paleta de cores</div><div className="text-t3 text-[0.84rem] mb-3">"Dinâmica" acompanha a cor da capa que está tocando.</div>
      <div className="flex flex-wrap gap-2.5">{PALETTES.map(([id, name, hue, c]) => (
        <button key={id} title={name} aria-label={`Paleta ${name}`} onClick={() => setSetting("palette", id)} className={cx("relative size-11 rounded-full grid place-items-center transition-transform hover:scale-110", cur === id && "ring-2 ring-t1 ring-offset-2 ring-offset-s1")}
          style={{ background: hue < 0 ? `conic-gradient(from 0deg, oklch(0.75 0.14 0), oklch(0.75 0.14 90), oklch(0.75 0.14 180), oklch(0.75 0.14 270), oklch(0.75 0.14 360))` : `oklch(0.75 ${0.14 * c} ${hue})` }}>
          {cur === id && <Check className="size-5 text-black/80" strokeWidth={3} />}
        </button>))}</div>
      <div className="text-t3 text-[0.8rem] mt-3">Atual: <b className="text-t1 font-medium">{PALETTES.find((p) => p[0] === cur)?.[1]}</b>{cur === "dynamic" && t ? ` · seguindo "${t.title}"` : ""}</div></div>
  );
}
function ShortcutsList() {
  return <div className="p-4 grid grid-cols-2 max-[1100px]:grid-cols-1 gap-x-8">{SHORTCUTS.flatMap(([, rows]) => rows).map(([k, l]) => <div key={k} className="flex items-center justify-between h-9 border-b border-line"><span className="text-t2">{l}</span><span className="flex gap-1">{k.split(" ").map((p, i) => (p === "/" || p === "+" ? <span key={i} className="text-t3">{p}</span> : <Kbd key={i}>{p}</Kbd>))}</span></div>)}</div>;
}
interface Alarm { id: number; time: string; playlist: string; on: boolean; random: boolean }
function Alarms() {
  const alarms = useSetting<Alarm[]>("alarms") ?? [];
  const playlists = useLib((s) => s.playlists);
  const save = (a: Alarm[]) => setSetting("alarms", a);
  const dup = (a: Alarm) => alarms.some((x) => x.id !== a.id && x.time === a.time);
  return (
    <div className="p-4">
      {alarms.length === 0 ? <div className="text-t3 py-3">Nenhum alarme ainda. Adicione um para acordar com música.</div> : alarms.map((a) => (
        <div key={a.id} className="flex items-center gap-3 py-2.5 border-b border-line last:border-0 flex-wrap">
          <AlarmClock className={cx("size-5", a.on ? "text-accent" : "text-t3")} />
          <input type="time" value={a.time} onChange={(e) => save(alarms.map((x) => (x.id === a.id ? { ...x, time: e.target.value } : x)))} className="h-9 px-2.5 rounded-lg bg-s2 tnum font-semibold text-[1.05rem]" />
          <Select value={a.playlist} onChange={(v) => save(alarms.map((x) => (x.id === a.id ? { ...x, playlist: v } : x)))} options={[["liked", "Curtidas"], ...playlists.map((p) => [p.id, p.title] as [string, string])]} />
          <button onClick={() => save(alarms.map((x) => (x.id === a.id ? { ...x, random: !x.random } : x)))} className="h-8 px-3 rounded-full bg-s2 hover:bg-s3 text-[0.82rem] font-medium">{a.random ? "Aleatório" : "Em ordem"}</button>
          {dup(a) && <span className="text-warn text-[0.78rem] inline-flex items-center gap-1"><TriangleAlert className="size-3.5" />Já existe um alarme neste horário</span>}
          <div className="flex-1" /><span className="text-t3 text-[0.8rem]">{a.on ? `Próximo: ${describeNext(a.time, new Date())}` : "Desativado"}</span>
          <Switch on={a.on} onChange={(on) => save(alarms.map((x) => (x.id === a.id ? { ...x, on } : x)))} />
          <IconBtn label="Apagar alarme" size={30} onClick={() => save(alarms.filter((x) => x.id !== a.id))}><Trash2 /></IconBtn>
        </div>))}
      <Btn size="sm" className="mt-3" icon={<Plus />} onClick={() => save([...alarms, { id: Date.now(), time: "07:00", playlist: "liked", on: true, random: false }])}>Adicionar alarme</Btn>
    </div>
  );
}
interface Health { id: string; status: "online" | "reachable" | "offline" | "unavailable"; ms: number; detail: string }
function ProviderHealth() {
  const t = useT();
  const order = useSetting<string[]>("providerOrder");
  const [rows, setRows] = useState<Health[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState("");
  const check = async () => {
    setBusy(true);
    const r = await invoke<Health[]>("provider_health").catch(() => undefined);
    setRows(r ?? []);
    setAt(new Date().toLocaleTimeString());
    setBusy(false);
  };
  useEffect(() => { check(); }, []);
  const label = { online: "No ar", reachable: "Alcançável", offline: "Fora do ar", unavailable: "Indisponível" };
  const first = order.find((i) => i !== "offline" && rows?.some((r) => r.id === i && r.status !== "unavailable"));
  const sorted = rows ? [...rows].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : [];
  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-3"><span className="text-t3 text-[0.84rem] flex-1">{busy ? t("Verificando…") : at ? t("Última verificação: {time}", { time: at }) : ""}</span><Btn size="sm" icon={busy ? <Spinner /> : <RefreshCw />} disabled={busy} onClick={check}>{t("Atualizar")}</Btn></div>
      {!busy && rows && !rows.length && <div className="text-t3 py-3">{t("A verificação só funciona no app nativo.")}</div>}
      {busy && !rows?.length && <div className="flex justify-center py-6"><Spinner className="size-5" /></div>}
      {sorted.map((h) => (
        <div key={h.id} className="flex items-center gap-3.5 h-14 border-b border-line last:border-0">
          <SourceIcon id={h.id} size={22} />
          <div className="flex-1"><div className="font-medium">{AUDIO_PROVIDERS[h.id]}</div><div className="text-t3 text-[0.8rem]">{h.status === "unavailable" ? t("Áudio protegido: sem suporte por enquanto") : h.detail}</div></div>
          {h.id === first && <Badge tone="accent">{t("1º da ordem")}</Badge>}
          {(h.status === "online" || h.status === "reachable") && <span className="text-t3 text-[0.82rem] tnum">{h.ms} ms</span>}
          <span className={cx("inline-flex items-center gap-2 text-[0.86rem] font-medium w-32 justify-end", h.status === "online" ? "text-ok" : h.status === "reachable" ? "text-warn" : h.status === "offline" ? "text-danger" : "text-t3")}>{busy ? <Spinner className="size-4" /> : <span className="size-2 rounded-full bg-current" />}{t(label[h.status])}</span>
        </div>))}
    </div>
  );
}
function Folders() {
  const folders = useLib((s) => s.folders), n = useLib((s) => s.localFiles.length);
  return (
    <div className="p-4">
      {folders.map((f) => <div key={f} className="flex items-center gap-3 h-12 border-b border-line"><FolderOpen className="size-5 text-accent" /><span className="flex-1 font-mono text-[0.86rem] truncate">{f}</span><IconBtn label="Remover pasta" size={30} onClick={() => removeFolder(f)}><X /></IconBtn></div>)}
      {!folders.length && <div className="text-t3 py-3">Nenhuma pasta adicionada.</div>}
      <div className="flex items-center gap-3 mt-3"><Btn size="sm" icon={<FolderPlus />} disabled={!isTauri} onClick={addFolder}>Adicionar pasta</Btn><span className="text-t3 text-[0.82rem]">{n} músicas encontradas</span></div>
    </div>
  );
}
function Integrations() {
  const t = useT();
  const libAccounts = useLib((s) => s.accounts), discord = useDiscord((s) => s.state);
  // o Discord não tem login: "conectado" é a conexão real com o aplicativo do Discord
  const accounts: Record<string, string | undefined> = { ...libAccounts, discord: discord === "ok" ? "ok" : undefined };
  const cards: [string, string, string, number, string?][] = [["discord", "Discord", "Mostre o que você ouve no seu perfil", 265, "discord"], ["lastfm", "Last.fm", "Scrobbling e Tocando agora", 10, "lastfm"], ["spotify", "Spotify", "Canvas, início personalizado e histórico", 150, "spotify"], ["tidal", "TIDAL", "Áudio Hi-Res e capas animadas", 220, "tidal"], ["qobuz", "Qobuz", "Áudio Hi-Res por resolvedores", 250], ["deezer", "Deezer", "Reprodução principal em FLAC e letras", 300, "deezer"], ["soundcloud", "SoundCloud", "Catálogo independente", 50, "soundcloud"], ["jiosaavn", "JioSaavn", "Músicas completas sem login", 175], ["together_settings", "Ouvir junto", "Servidor, nome de usuário e aprovações", 120]];
  return (
    <div className="grid gap-3 p-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(17rem, 1fr))" }}>{cards.map(([id, name, desc, hue, acc]) => (
      <button key={id} onClick={() => nav(`settings/${id}`)} className="flex items-center gap-3.5 p-4 rounded-2xl bg-s2 hover:bg-s3 text-left transition-colors">
        {isBrand(id) ? <BrandTile id={id} size={44} /> : <span className="size-11 rounded-xl bg-s3 text-t2 grid place-items-center shrink-0"><Users className="size-5" /></span>}
        <div className="min-w-0 flex-1"><div className="font-semibold flex items-center gap-2">{name}{acc && accounts[acc] && <span className="size-2 rounded-full bg-ok" />}{UNAVAILABLE_PROVIDERS.includes(id) && <Badge>{t("Indisponível")}</Badge>}</div><div className="text-t3 text-[0.82rem] truncate">{UNAVAILABLE_PROVIDERS.includes(id) ? t("Áudio protegido: sem suporte por enquanto") : acc && accounts[acc] ? (id === "discord" ? t("Conectado ao Discord") : t("Conectado como {name}", { name: accounts[acc] })) : t(desc)}</div></div>
        <ChevronRight className="size-4 text-t3" />
      </button>))}</div>
  );
}
function LoginCard({ service }: { service: string }) {
  const acc = useLib((s) => s.accounts[service]);
  const name = { discord: "Discord", lastfm: "Last.fm", spotify: "Spotify", tidal: "TIDAL", deezer: "Deezer", soundcloud: "SoundCloud" }[service] ?? service;
  return (
    <div className="flex items-center gap-4 p-4">
      {isBrand(service) ? <BrandTile id={service} size={44} /> : <div className={cx("size-11 rounded-full grid place-items-center", acc ? "bg-ok/15 text-ok" : "bg-s3 text-t3")}>{acc ? <Check className="size-5" /> : <CircleUser className="size-5" />}</div>}
      <div className="flex-1"><div className="font-medium">{acc ? `Conectado como ${acc}` : `Não conectado ao ${name}`}</div><div className="text-t3 text-[0.84rem]">{acc ? "A sessão fica guardada só neste computador." : "Entre pela web ou cole um token/cookie."}</div></div>
      {acc ? <Btn variant="outline" onClick={() => { if (service === "lastfm" && isTauri) { logoutLastfm(); return; } if (service === "soundcloud" && isTauri) { logoutSc(); return; } if (service === "spotify" && isTauri) { logoutSp(); return; } useLib.getState().setAccount(service, null); toast(`Desconectado do ${name}`); }}>Sair</Btn> : <Btn variant="primary" onClick={() => openDialog("login", { service })}>Entrar</Btn>}
    </div>
  );
}
function DiscordStatus() {
  const t = useT(); const d = useDiscord();
  if (!isTauri) return <div className="p-4 text-t3 text-[0.86rem]">{t("A presença só funciona no app nativo.")}</div>;
  return <div className="p-4 flex items-center gap-3 text-[0.88rem]"><span className={cx("size-2.5 rounded-full", d.state === "ok" ? "bg-ok" : d.state === "error" ? "bg-danger" : "bg-t3")} /><span className={d.state === "error" ? "text-danger" : "text-t2"}>{d.state === "ok" ? t("Conectado ao Discord") : d.state === "error" ? d.message : t("Aguardando uma música tocando")}</span></div>;
}
function DiscordPreview() {
  const t = useCurrent(); const pos = usePlayer((s) => Math.floor(s.position));
  const details = useSetting<boolean>("discordUseDetails"), provider = useSetting<boolean>("discordShowProvider"), activity = useSetting<string>("discordActivity"), custom = useSetting<string>("discordName"), b1 = useSetting<string>("discordBtn1"), b2 = useSetting<string>("discordBtn2"), pb = useSetting<boolean>("discordPlaybackDetails");
  const verb = { playing: "Jogando", listening: "Ouvindo", watching: "Assistindo", competing: "Competindo em" }[activity] ?? "Ouvindo";
  if (!t) return null;
  const a = artistOf(t);
  return (
    <div className="p-4"><div className="text-[0.72rem] font-semibold uppercase tracking-wider text-t3 mb-2.5">Prévia do Rich Presence</div>
      <div className="rounded-xl p-4 max-w-sm" style={{ background: "#232428", color: "#dbdee1" }}>
        <div className="text-[0.72rem] font-bold uppercase mb-2.5" style={{ color: "#b5bac1" }}>{verb} {custom || "MetroMusic"}{provider ? ` · ${SOURCES.find((s) => s.id === t.provider)?.name}` : ""}</div>
        <div className="flex gap-3"><Cover hue={t.hue} seed={t.seed} src={t.art} className="size-16 rounded-lg" /><div className="min-w-0 text-[0.86rem] leading-snug"><div className="font-semibold truncate text-white">{details ? t.title : a}</div><div className="truncate">{details ? a : t.title}</div>{pb && <div className="truncate opacity-80">{t.format} · {t.bitrate}</div>}<div className="tnum opacity-80">{Math.floor(pos / 60)}:{String(pos % 60).padStart(2, "0")} decorridos</div></div></div>
        <div className="mt-3 space-y-1.5">{[b1 || "Ouvir no YouTube Music", b2 || "Conhecer o MetroMusic"].map((b) => <div key={b} className="h-8 rounded grid place-items-center text-[0.84rem] font-medium text-white" style={{ background: "#4e5058" }}>{b.replace("{song_name}", t.title).replace("{artist_name}", a)}</div>)}</div>
      </div></div>
  );
}
function StorageBars() {
  const t = useT();
  const [real, setReal] = useState<{ bytes: number; entries: number } | null>(null);
  const [img, setImg] = useState<{ bytes: number; files: number } | null>(null);
  const downloaded = useLib((s) => Object.keys(s.downloadPaths).length);
  useEffect(() => {
    if (!backend) return;
    let on = true;
    const poll = () => { engine.cacheStats().then((s) => { if (on && s) setReal(s); }); engine.imageStats()?.then((s) => { if (on && s) setImg(s); }); };
    poll();
    const id = setInterval(poll, 2500);
    return () => { on = false; clearInterval(id); };
  }, []);
  const fmt = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(".", ",")} GB` : mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1).replace(".", ",")} MB`);
  if (!real) return <div className="p-4 text-t3 text-[0.88rem]">{t("O uso do disco só aparece no app nativo.")}</div>;
  const mb = real.bytes / 1048576;
  return (
    <div className="p-4"><div className="flex items-baseline gap-2 mb-3"><span className="text-[1.6rem] font-bold tracking-tight tnum">{fmt(mb)}</span><span className="text-t3">{t("em cache de músicas")}</span></div>
      <div className="text-t3 text-[0.86rem]">{t("{n} faixas guardadas para tocar sem baixar de novo", { n: real.entries })}</div>
      {img && <div className="text-t3 text-[0.86rem] mt-1.5">{t("Imagens: {size} em {n} arquivos", { size: fmt(img.bytes / 1048576), n: img.files })}</div>}
      <div className="text-t3 text-[0.86rem] mt-1.5">{t("Downloads: {n} músicas no computador", { n: downloaded })}</div></div>
  );
}
/** O que o app está usando agora para desenhar: placa de vídeo ou software, e se o modo leve está ligado. */
function PerfStatus() {
  const t = useT();
  const { low, reason, gpu } = usePerf();
  const software = !!gpu && /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i.test(gpu);
  return (
    <div className="px-4 py-3.5 text-[0.88rem]">
      <div className="flex items-center gap-2"><span className={cx("size-2.5 rounded-full", low ? "bg-warn" : "bg-ok")} /><span className="font-medium">{low ? t("Modo leve ligado") : t("Efeitos completos")}</span></div>
      <div className="text-t3 mt-1.5">{gpu ? `${software ? t("Desenhando por software") : t("Placa de vídeo")}: ${gpu}` : t("Placa de vídeo não identificada")}</div>
      {reason && <div className="text-t3">{t("Motivo")}: {t(reason)}</div>}
    </div>
  );
}
function Updater() {
  const t = useT();
  const { status, current, version, error } = useUpdate();
  useEffect(() => { currentVersion(); }, []);
  let line = t("Ainda não verificado");
  if (status === "checking") line = t("Verificando…");
  else if (status === "error") line = `${t("Não foi possível verificar")}: ${error}`;
  else if (status === "none") line = t("Você está na versão mais recente");
  else if (status === "available" || status === "downloading" || status === "restarting") line = `${t("Nova versão disponível")}: ${version}`;
  const hasNew = status === "available" || status === "downloading" || status === "restarting";
  return (
    <div className="p-4">
      <div className="flex items-center gap-4"><div className="size-12 rounded-xl bg-accent text-accent-fg grid place-items-center"><AudioLines /></div>
        <div className="flex-1"><div className="font-semibold">MetroMusic {current || "0.1.0"}</div><div className="text-t3 text-[0.84rem]">{line}</div></div>
        {hasNew && <Btn variant="primary" icon={<Download />} onClick={() => openDialog("update")}>{t("Ver e atualizar")}</Btn>}
        <Btn icon={<RefreshCw />} disabled={status === "checking" || status === "downloading" || !isTauri} onClick={() => checkUpdates(true)}>{t("Procurar atualizações")}</Btn>
      </div>
    </div>
  );
}
function Changelog() {
  const log: [string, string, string[]][] = [["0.1.0", "9 de novembro de 2026", ["Primeira prévia da interface desktop", "Início com várias fontes, biblioteca, busca e explorar", "Player com fila, letra sincronizada e Tocando agora", "Temas, paletas e tema dinâmico pela capa", "Ouvir junto, reconhecimento, equalizador e retrospectiva (simulados)"]]];
  return <div className="p-4">{log.map(([v, d, items]) => <div key={v}><div className="flex items-baseline gap-2 mb-2"><span className="font-semibold">Versão {v}</span><span className="text-t3 text-[0.82rem]">{d}</span></div><ul className="list-disc pl-5 text-t2 space-y-1">{items.map((i) => <li key={i}>{i}</li>)}</ul></div>)}</div>;
}
function About() {
  return (
    <div className="p-6 text-center">
      <div className="size-20 rounded-3xl bg-accent text-accent-fg grid place-items-center mx-auto mb-4"><AudioLines className="size-10" /></div>
      <div className="text-[1.6rem] font-bold tracking-tight">MetroMusic</div><div className="text-t3">Versão 0.1.0 · prévia da interface</div>
      <p className="text-t2 max-w-md mx-auto mt-4">Player de música para desktop, offline e online, feito com Rust e Tauri. Baseado nas ideias do MetroFuse e do Metrolist.</p>
      <div className="flex justify-center gap-2 mt-5 flex-wrap"><Btn variant="ghost" icon={<Scale />} onClick={() => toast("GNU General Public License v3.0")}>Licença GPL-3.0</Btn></div>
      <div className="mt-7 text-left max-w-md mx-auto rounded-xl bg-s2 divide-y divide-line">{[["Baseado em", "MetroFuse · Metrolist · InnerTune · OuterTune"], ["Letras", "Better Lyrics · LrcLib"], ["Interface", "Tauri · React · Tailwind · Motion"]].map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-[0.86rem]"><span className="text-t3">{k}</span><span className="text-right">{v}</span></div>)}</div>
      <div className="text-t3 text-[0.78rem] mt-5 max-w-md mx-auto">Projeto independente e não oficial, sem vínculo com YouTube, Google, Spotify, TIDAL, Deezer, Qobuz ou SoundCloud.</div>
    </div>
  );
}
function LtBlocked() { const b = useLT((s) => s.blocked); return <div className="flex items-center gap-4 p-4"><div className="flex-1"><div className="font-medium">Pessoas bloqueadas</div><div className="text-t3 text-[0.84rem]">{b.length ? `${b.length} bloqueada(s): ${b.join(", ")}` : "Ninguém bloqueado"}</div></div>{b.length > 0 && <Btn size="sm" onClick={() => useLT.setState({ blocked: [] })}>Desbloquear todas</Btn>}</div>; }
function LtLogs() { return <div className="flex items-center gap-4 p-4"><div className="flex-1"><div className="font-medium">Registros de conexão</div><div className="text-t3 text-[0.84rem]">Eventos e mensagens para depuração</div></div><Btn size="sm" onClick={() => nav("together")}>Abrir Ouvir junto</Btn></div>; }

function Custom({ id }: { id: string }) {
  if (id.startsWith("login:")) return <LoginCard service={id.slice(6)} />;
  switch (id) {
    case "themeMode": return <ThemeMode />; case "palette": return <PalettePicker />; case "shortcuts": return <ShortcutsList />; case "alarms": return <Alarms />;
    case "providerHealth": return <ProviderHealth />; case "folders": return <Folders />; case "integrations": return <Integrations />; case "discordPreview": return <DiscordPreview />;
    case "perfStatus": return <PerfStatus />; case "storage": return <StorageBars />; case "updater": return <Updater />; case "changelog": return <Changelog />; case "about": return <About />; case "discordStatus": return <DiscordStatus />; case "ltBlocked": return <LtBlocked />; case "ltLogs": return <LtLogs />;
  }
  return null;
}

// ───────── Renderizador genérico
function OrderList({ item }: { item: Extract<Item, { t: "order" }> }) {
  const t = useT();
  const blocked = item.k === "providerOrder" ? UNAVAILABLE_PROVIDERS : item.k === "lyricsOrder" ? ["deezer"] : [];
  const saved = useSetting<string[]>(item.k); const off = useSetting<string[]>(item.offKey ?? "__none") ?? [];
  const order = [...saved.filter((i) => item.names[i]), ...Object.keys(item.names).filter((i) => !saved.includes(i))];
  return (
    <Reorder.Group axis="y" values={order} onReorder={(v) => setSetting(item.k, v)} className="p-2">
      {order.map((id, i) => (
        <Reorder.Item key={id} value={id} whileDrag={{ scale: 1.02, boxShadow: "0 10px 30px #0007", zIndex: 5 }} className="flex items-center gap-3 h-13 px-2.5 rounded-xl bg-s1 hover:bg-s2 cursor-grab active:cursor-grabbing relative">
          <GripVertical className="size-4 text-t3" /><span className="w-5 text-center text-t3 tnum text-[0.84rem] font-semibold">{i + 1}</span>
          {item.k === "providerOrder" ? <SourceIcon id={id} size={22} /> : lyricsBrand(id) ? <BrandIcon id={lyricsBrand(id)!} size={22} /> : <ScrollText className="size-[1.35rem] text-t3 shrink-0" />}
          <span className={cx("flex-1 font-medium", (off.includes(id) || blocked.includes(id)) && "text-t3 line-through")}>{t(item.names[id])}</span>
          {blocked.includes(id) ? <Badge>{t("Indisponível")}</Badge> : item.offKey && <Switch on={!off.includes(id)} onChange={(on) => setSetting(item.offKey!, on ? off.filter((x) => x !== id) : [...off, id])} />}
        </Reorder.Item>))}
    </Reorder.Group>
  );
}

function Row({ item, locked }: { item: Item; locked?: boolean }) {
  const t = useT();
  const all = useSettings((s) => s.v);
  const get = (k: string) => (k in all ? all[k] : DEFAULTS[k]);
  if (item.t === "custom") return locked || item.soon ? <div className="opacity-40 pointer-events-none"><Custom id={item.id} /></div> : <Custom id={item.id} />;
  if (item.t === "order") return <OrderList item={item} />;
  if (item.t === "note") return <div className={cx("flex gap-3 m-3 p-3.5 rounded-xl text-[0.88rem] leading-relaxed", item.tone === "warn" ? "bg-warn/12 text-warn" : "bg-s2 text-t2")}>{item.tone === "warn" ? <TriangleAlert className="size-4.5 shrink-0 mt-0.5" /> : <Info className="size-4.5 shrink-0 mt-0.5" />}<span>{t(item.text)}</span></div>;
  const soon = !!item.soon;
  const disabled = locked || soon || ("dep" in item && item.dep ? !get(item.dep) : false);
  const Icon = iconFor(item);
  const danger = item.t === "action" && item.danger;
  const text = (
    <div className="flex-1 min-w-0 flex items-center gap-3.5">
      {Icon && <span className={cx("size-9 rounded-[10px] grid place-items-center shrink-0 [&>svg]:size-[1.1rem]", danger ? "bg-danger/12 text-danger" : "bg-s2 text-t2")}><Icon /></span>}
      <div className="min-w-0"><div className="font-medium flex items-center gap-2">{t(item.label)}{soon && <Badge>{t("Em breve")}</Badge>}</div>{item.desc && <div className="text-t3 text-[0.84rem] leading-snug mt-0.5">{t(item.desc)}</div>}</div>
    </div>
  );
  const wrap = (control: ReactNode, onClick?: () => void, stacked?: boolean) => (
    <div onClick={onClick} className={cx("flex gap-4 px-4 py-3.5 min-h-14 transition-opacity", stacked ? "flex-col" : "items-center", disabled && "opacity-40 pointer-events-none", onClick && "hover:bg-s2 cursor-pointer")}>{text}{control}</div>
  );
  switch (item.t) {
    case "toggle": return wrap(<Switch on={!!get(item.k)} onChange={(v) => setSetting(item.k, v)} label={item.label} />, () => setSetting(item.k, !get(item.k)));
    case "select": return wrap(<Select value={String(get(item.k))} onChange={(v) => setSetting(item.k, v)} options={item.options.map(([v, l]) => [v, t(l)] as [string, string])} />);
    case "slider": { const v = Number(get(item.k)); return wrap(<div className="flex items-center gap-3 w-72 max-w-full shrink-0"><Range value={v} min={item.min} max={item.max} step={item.step} onChange={(x) => setSetting(item.k, x)} className="flex-1 thumb" label={item.label} /><span className="w-24 text-right tnum text-t2 text-[0.88rem]">{String(Number.isInteger(item.step) ? v : v.toFixed(2)).replace(".", ",")} {item.unit}</span></div>); }
    case "text": return wrap(<TextField value={String(get(item.k) ?? "")} onChange={(v) => setSetting(item.k, v)} placeholder={item.placeholder ? t(item.placeholder) : undefined} secret={item.secret} multiline={item.multiline} className={item.multiline ? "w-full" : "w-72 max-w-full shrink-0"} />, undefined, item.multiline);
    case "action": return wrap(<Btn size="sm" variant={item.danger ? "danger" : "soft"} onClick={() => runAction(item.action)}>{t(item.button)}</Btn>);
    case "link": return wrap(<ChevronRight className="size-4.5 text-t3" />, () => nav(item.to));
  }
}

export default function Settings({ page = "appearance" }: { page?: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const p = PAGES.find((x) => x.id === page) ?? PAGES[0];
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [p.id]);
  const parent = p.parent ? PAGES.find((x) => x.id === p.parent) : undefined;
  const top = PAGES.filter((x) => !x.parent);
  const groups = [...new Set(top.map((x) => x.group))];
  const results = useMemo(() => {
    const n = norm(q.trim()); if (!n) return null;
    const out: { page: Page; item: Item }[] = [];
    for (const pg of PAGES) for (const s of pg.sections) for (const it of s.items) if ("label" in it && it.label && norm(`${t(it.label)} ${"desc" in it && it.desc ? t(it.desc) : ""}`).includes(n)) out.push({ page: pg, item: it });
    return out;
  }, [q, t]);
  return (
    <div className="flex h-[calc(100vh-9.1rem)]">
      <div className="w-64 shrink-0 overflow-y-auto pl-6 pr-3 py-5">
        <h1 className="text-[1.6rem] font-bold tracking-tight mb-3 px-2">{t("Configurações")}</h1>
        <TextField value={q} onChange={setQ} placeholder={t("Buscar configuração")} icon={<Search />} className="mb-4" />
        {groups.map((g) => (
          <div key={g} className="mb-4"><div className="px-3 mb-1 text-[0.72rem] font-semibold uppercase tracking-wider text-t3">{t(g === "Contas" ? "Contas e serviços" : g)}</div>
            {top.filter((x) => x.group === g).map((x) => { const active = !results && (x.id === p.id || x.id === p.parent); return (
              <button key={x.id} onClick={() => { setQ(""); nav(`settings/${x.id}`); }} className={cx("relative w-full h-10 px-3 rounded-lg flex items-center gap-3 text-left font-medium transition-colors [&>svg]:size-4.5 [&>svg]:shrink-0", active ? "text-t1" : "text-t2 hover:text-t1 hover:bg-s2")}>
                {active && <motion.span layoutId="settings-pill" className="absolute inset-0 rounded-lg bg-s2" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}<span className="relative grid">{ICONS[x.id]}</span><span className="relative truncate">{t(x.title)}</span>
              </button>); })}</div>
        ))}
      </div>
      <div ref={scroller} className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
        <AnimatePresence mode="wait" initial={false}>
        <motion.div key={results ? "busca" : p.id} className="max-w-[52rem]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}>
          {results ? (<>
            <h2 className="text-[1.6rem] font-bold tracking-tight mb-1">{t("Resultados")}</h2><div className="text-t3 mb-5">{t(results.length === 1 ? "{n} opção encontrada para \"{q}\"" : "{n} opções encontradas para \"{q}\"", { n: results.length, q: q.trim() })}</div>
            {results.length === 0 ? <div className="text-t3 py-10 text-center">{t("Nenhuma configuração corresponde à busca.")}</div> : <div className="rounded-2xl bg-s1 divide-y divide-line overflow-hidden">{results.map(({ page: pg, item }, i) => <div key={i}><button className="px-4 pt-2.5 text-accent text-[0.76rem] font-semibold hover:underline" onClick={() => { setQ(""); nav(`settings/${pg.id}`); }}>{t(pg.title)}</button><Row item={item} locked={!!pg.unavailable} /></div>)}</div>}
          </>) : (<>
            {parent && <button className="text-t3 hover:text-t1 text-[0.86rem] font-medium inline-flex items-center gap-1 mb-1" onClick={() => nav(`settings/${parent.id}`)}>{t(parent.title)}<ChevronRight className="size-3.5" /></button>}
            <h2 className="text-[1.6rem] font-bold tracking-tight">{t(p.title)}</h2><div className="text-t3 mb-5">{t(p.desc)}</div>
            {p.unavailable && <div className="flex gap-3 mb-5 p-3.5 rounded-xl text-[0.88rem] leading-relaxed bg-warn/12 text-warn"><TriangleAlert className="size-4.5 shrink-0 mt-0.5" /><span><b className="font-semibold">{t("Indisponível.")}</b> {t(p.unavailable)}</span></div>}
            {p.sections.map((s, i) => (
              <section key={i} className="mb-6">
                {s.title && <div className="px-1 mb-2 text-[0.76rem] font-semibold uppercase tracking-wider text-t3">{t(s.title)}</div>}
                <div className={cx("rounded-2xl divide-y divide-line overflow-hidden", s.items.length === 1 && s.items[0].t === "custom" && s.items[0].id === "integrations" ? "" : "bg-s1")}>{s.items.map((it, k) => <Row key={k} item={it} locked={!!p.unavailable} />)}</div>
              </section>
            ))}
          </>)}
        </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
export { Bell, Gauge, Languages, Music, resolvePlaylist, useUI, AnimatePresence };
