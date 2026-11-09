import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AudioLines, ChevronLeft, ChevronRight, CircleUser, Clock, Compass, Gift, History, House, Keyboard, Library, LogOut, Mic, PanelLeft, Plus, Search, Settings, TrendingUp, Users, WifiOff, X, Check, ChevronDown, Import, CloudOff, Wifi } from "lucide-react";
import { albums, artistOf, artists, getArtist, songs, SOURCES } from "../lib/catalog";
import { addTo, playlistMenu } from "../lib/menus";
import { cx, norm } from "../lib/util";
import { AUTO, resolvePlaylist, useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { useSetting } from "../store/settings";
import { nav, openDialog, toast, useRoute, useUI } from "../store/ui";
import { isNativeMac } from "../lib/native";
import { WindowControls } from "./WindowControls";
import { Cover, Eq, IconBtn, Kbd } from "./ui";

// ───────── Barra lateral
function NavItem({ to, icon, label, collapsed, match }: { to: string; icon: React.ReactNode; label: string; collapsed: boolean; match?: string }) {
  const route = useRoute();
  const active = route === to || route.startsWith((match ?? to) + "/") || route === match;
  return (
    <button onClick={() => nav(to)} title={collapsed ? label : undefined} className={cx("relative w-full h-10 rounded-lg flex items-center gap-3 font-medium transition-colors [&>svg]:size-5 [&>svg]:shrink-0", collapsed ? "justify-center" : "px-3", active ? "text-t1" : "text-t2 hover:text-t1 hover:bg-s2")}>
      {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-lg bg-s2" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
      <span className="relative grid">{icon}</span>{!collapsed && <span className="relative truncate">{label}</span>}
      {active && <motion.span layoutId="nav-dot" className="absolute left-0 w-[3px] h-5 rounded-r-full bg-accent" />}
    </button>
  );
}

function SidePlaylist({ id, collapsed }: { id: string; collapsed: boolean }) {
  const lib = useLib();
  const p = useMemo(() => resolvePlaylist(id, lib), [id, lib]);
  const route = useRoute(); const openMenu = useUI((s) => s.openMenu);
  const playingThis = usePlayer((s) => s.playing && s.queueTitle === p?.title);
  const [over, setOver] = useState(false);
  if (!p) return null;
  const own = lib.playlists.some((x) => x.id === id);
  const active = route === `playlist/${id}`;
  return (
    <button onClick={() => nav(`playlist/${id}`)} onContextMenu={(e) => openMenu(e, playlistMenu(p))} title={collapsed ? p.title : undefined}
      onDragOver={own ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); } : undefined} onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const ids = JSON.parse(e.dataTransfer.getData("application/x-tracks") || "[]"); if (ids.length) addTo(id, ids); }}
      className={cx("w-full flex items-center gap-3 rounded-lg transition-colors text-left", collapsed ? "justify-center h-12" : "h-12 px-2", active ? "bg-s2" : "hover:bg-s2", over && "!bg-accent-soft ring-2 ring-accent")}>
      <Cover hue={p.hue} seed={p.seed} icon={p.icon} className="size-9 rounded-md" />
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className={cx("truncate font-medium text-[0.9rem]", playingThis && "text-accent")}>{p.title}</div>
          <div className="truncate text-t3 text-[0.78rem]">{p.kind === "auto" ? "Automática" : p.kind === "local" ? "Playlist" : p.owner} · {p.trackIds.length} músicas</div>
        </div>
      )}
      {!collapsed && playingThis && <Eq className="mr-1" />}
    </button>
  );
}

export function Sidebar() {
  const collapsed = useUI((s) => s.sidebarCollapsed), toggle = useUI((s) => s.toggleSidebar), openMenuAt = useUI((s) => s.openMenuAt);
  const playlists = useLib((s) => s.playlists), saved = useLib((s) => s.savedPlaylists);
  const together = useSetting<boolean>("showTogetherInSidebar"), libTab = useSetting<string>("defaultLibTab");
  const show: Record<string, boolean> = { liked: useSetting("showLiked"), downloaded: useSetting("showDownloaded"), top: useSetting("showTop"), local: useSetting("showLocal"), cached: useSetting("showCached"), uploaded: useSetting("showUploaded") };
  const autos = Object.keys(AUTO).filter((k) => show[k]);
  const [filter, setFilter] = useState("");
  const list = [...playlists.map((p) => p.id), ...saved].filter((id) => !filter || norm(resolvePlaylist(id)?.title ?? "").includes(norm(filter)));
  return (
    <motion.nav animate={{ width: collapsed ? 76 : 256 }} transition={{ type: "spring", stiffness: 420, damping: 40 }} className="shrink-0 h-full flex flex-col border-r border-line bg-s1/50 overflow-hidden">
      <div data-tauri-drag-region className={cx("flex items-center shrink-0", isNativeMac && collapsed ? "h-24 items-end pb-2 justify-center" : "h-14", !(isNativeMac && collapsed) && (collapsed ? "justify-center" : "pl-4 pr-2 gap-2.5"))}>
        {isNativeMac && !collapsed && <div data-tauri-drag-region className="w-[68px] shrink-0 self-stretch" />}
        {!collapsed && <><div data-tauri-drag-region className="size-8 rounded-[9px] bg-accent text-accent-fg grid place-items-center"><AudioLines className="size-5 pointer-events-none" /></div>{isNativeMac ? <div data-tauri-drag-region className="flex-1 self-stretch" /> : <span data-tauri-drag-region className="font-bold text-[1.08rem] tracking-tight flex-1">MetroMusic</span>}</>}
        <IconBtn label={collapsed ? "Expandir barra lateral (Ctrl+B)" : "Recolher barra lateral (Ctrl+B)"} size={34} onClick={toggle}><PanelLeft /></IconBtn>
      </div>
      <div className="px-2.5 flex flex-col gap-0.5">
        <NavItem to="home" icon={<House />} label="Início" collapsed={collapsed} />
        <NavItem to="explore" icon={<Compass />} label="Explorar" collapsed={collapsed} match="browse" />
        <NavItem to={`library/${libTab}`} match="library" icon={<Library />} label="Biblioteca" collapsed={collapsed} />
        {together && <NavItem to="together" icon={<Users />} label="Ouvir junto" collapsed={collapsed} />}
        <NavItem to="recognize" icon={<Mic />} label="Reconhecer música" collapsed={collapsed} />
      </div>
      <div className={cx("flex items-center mt-5 mb-1.5 shrink-0", collapsed ? "justify-center" : "pl-5 pr-2.5")}>
        {!collapsed && <span className="flex-1 text-[0.72rem] font-semibold uppercase tracking-wider text-t3">Suas playlists</span>}
        <IconBtn label="Nova playlist ou importar" size={30} onClick={(e) => openMenuAt(e.currentTarget, [
          { label: "Nova playlist", icon: <Plus />, onClick: () => openDialog("createPlaylist") },
          { label: "Importar playlist…", icon: <Import />, onClick: () => openDialog("import") },
        ])}><Plus /></IconBtn>
      </div>
      {!collapsed && playlists.length + saved.length > 8 && (
        <div className="px-2.5 mb-1.5 relative"><Search className="absolute left-5 top-1/2 -translate-y-1/2 size-3.5 text-t3" /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar playlists" className="w-full h-8 pl-8 pr-2 rounded-lg bg-s2 text-[0.84rem] placeholder:text-t3" /></div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-3 flex flex-col gap-0.5">
        {!filter && autos.map((id) => <SidePlaylist key={id} id={id} collapsed={collapsed} />)}
        {!filter && autos.length > 0 && <div className="h-px bg-line my-1.5 mx-2 shrink-0" />}
        {list.map((id) => <SidePlaylist key={id} id={id} collapsed={collapsed} />)}
        {!collapsed && <div className="text-t3 text-[0.76rem] px-2 pt-3 leading-snug">Arraste músicas para uma playlist para adicioná-las.</div>}
      </div>
    </motion.nav>
  );
}

// ───────── Barra superior
function SearchBox() {
  const route = useRoute();
  const fromRoute = route.startsWith("search/") ? decodeURIComponent(route.slice(7)) : "";
  const [q, setQ] = useState(fromRoute); const [focus, setFocus] = useState(false); const [i, setI] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const history = useLib((s) => s.searchHistory);
  const paused = useSetting<boolean>("pauseSearchHistory");
  useEffect(() => setQ(fromRoute), [fromRoute]);
  useEffect(() => { const f = () => { input.current?.focus(); input.current?.select(); }; window.addEventListener("focus-search", f); return () => window.removeEventListener("focus-search", f); }, []);
  const n = norm(q.trim());
  const sugg = useMemo(() => {
    if (!n) return [] as { label: string; sub: string; go: () => void; cover?: { hue: number; seed: number; artist?: boolean } }[];
    const hit = (s: string) => norm(s).includes(n);
    return [
      ...artists.filter((a) => hit(a.name)).slice(0, 2).map((a) => ({ label: a.name, sub: "Artista", cover: { hue: a.hue, seed: a.seed, artist: true }, go: () => nav(`artist/${a.id}`) })),
      ...albums.filter((a) => hit(a.title)).slice(0, 2).map((a) => ({ label: a.title, sub: `Álbum · ${getArtist(a.artistId)?.name}`, cover: a, go: () => nav(`album/${a.id}`) })),
      ...songs.filter((t) => hit(t.title)).slice(0, 4).map((t) => ({ label: t.title, sub: `Música · ${artistOf(t)}`, cover: t, go: () => usePlayer.getState().play([t.id], 0, "Busca") })),
    ];
  }, [n]);
  const go = (text: string) => { const s = text.trim(); if (!s) return; if (!paused) useLib.getState().pushSearch(s); setFocus(false); input.current?.blur(); nav(`search/${encodeURIComponent(s)}`); };
  const rows = n ? sugg.length + 1 : history.length;
  return (
    <div className="relative flex-1 max-w-[30rem]" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocus(false)}>
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4.5 text-t3 pointer-events-none" />
      <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(-1); }} onFocus={() => setFocus(true)} placeholder="Buscar músicas, artistas, álbuns…"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(rows - 1, v + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(-1, v - 1)); }
          else if (e.key === "Escape") { setFocus(false); input.current?.blur(); }
          else if (e.key === "Enter") { if (n && i >= 0 && i < sugg.length) { sugg[i].go(); setFocus(false); } else if (!n && i >= 0) go(history[i]); else go(q); }
        }}
        className="w-full h-10 pl-10.5 pr-20 rounded-full bg-s2 border border-transparent focus:border-accent/50 focus:bg-s1 placeholder:text-t3 transition-colors" />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {q ? <button aria-label="Limpar busca" className="size-6 grid place-items-center rounded-full hover:bg-s3 text-t3" onClick={() => { setQ(""); input.current?.focus(); }}><X className="size-4" /></button> : <span className="flex gap-0.5 opacity-70"><Kbd>Ctrl</Kbd><Kbd>F</Kbd></span>}
      </div>
      <AnimatePresence>
        {focus && rows > 0 && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.13 }} style={{ boxShadow: "var(--shadow)" }} className="absolute top-12 inset-x-0 z-40 p-1.5 rounded-2xl bg-s2/95 backdrop-blur-xl">
            {!n && <div className="px-3 pt-1.5 pb-1 text-[0.72rem] font-semibold uppercase tracking-wider text-t3">Buscas recentes</div>}
            {!n && history.map((h, k) => (
              <div key={h} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} className={cx("group h-10 px-3 rounded-lg flex items-center gap-3", k === i ? "bg-s3" : "hover:bg-s3")}>
                <Clock className="size-4 text-t3" /><span className="flex-1 truncate">{h}</span>
                <button aria-label="Remover do histórico" className="opacity-0 group-hover:opacity-100 text-t3 hover:text-t1" onClick={(e) => { e.stopPropagation(); useLib.getState().removeSearch(h); }}><X className="size-4" /></button>
              </div>
            ))}
            {n && sugg.map((s, k) => (
              <div key={k} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => { s.go(); setFocus(false); }} className={cx("h-12 px-2.5 rounded-lg flex items-center gap-3", k === i ? "bg-s3" : "hover:bg-s3")}>
                <Cover hue={s.cover!.hue} seed={s.cover!.seed} artist={(s.cover as any).artist} className="size-8.5 rounded-md" />
                <span className="flex-1 min-w-0"><span className="block truncate font-medium">{s.label}</span><span className="block truncate text-t3 text-[0.8rem]">{s.sub}</span></span>
              </div>
            ))}
            {n && <div tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => go(q)} className={cx("h-10 px-3 rounded-lg flex items-center gap-3", i === sugg.length ? "bg-s3" : "hover:bg-s3")}><Search className="size-4 text-t3" /><span className="truncate">Buscar por "<b className="font-semibold">{q.trim()}</b>"</span></div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TopBar() {
  const idx = useUI((s) => s.idx), len = useUI((s) => s.stack.length), back = useUI((s) => s.back), fwd = useUI((s) => s.fwd);
  const source = useUI((s) => s.homeSource), setSource = useUI((s) => s.setHomeSource), openMenuAt = useUI((s) => s.openMenuAt);
  const online = useUI((s) => s.online), setOnline = useUI((s) => s.setOnline);
  const route = useRoute();
  const together = useSetting<boolean>("showTogetherInSidebar");
  const accounts = useLib((s) => s.accounts);
  const src = SOURCES.find((s) => s.id === source)!;
  return (
    <header data-tauri-drag-region className="h-14 shrink-0 flex items-center gap-2 px-4 relative z-30">
      <IconBtn label="Voltar (Alt+←)" size={34} disabled={idx === 0} onClick={back}><ChevronLeft className="!size-5" /></IconBtn>
      <IconBtn label="Avançar (Alt+→)" size={34} disabled={idx >= len - 1} onClick={fwd}><ChevronRight className="!size-5" /></IconBtn>
      <SearchBox />
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      {!online && <span className="hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-warn/15 text-warn text-[0.78rem] font-semibold"><CloudOff className="size-3.5" />Offline</span>}
      <button title="Fonte do conteúdo da tela inicial" onClick={(e) => openMenuAt(e.currentTarget, [
        { header: true, label: "Fonte da tela inicial" },
        ...SOURCES.filter((s) => s.home).map((s) => ({ label: s.name, icon: <span className="size-2.5 rounded-full mx-[3px]" style={{ background: `oklch(0.72 0.16 ${s.hue})` }} />, checked: s.id === source, onClick: () => { setSource(s.id); if (!route.startsWith("home")) nav("home"); } })),
      ])} className="h-9 pl-3 pr-2 rounded-full bg-s2 hover:bg-s3 inline-flex items-center gap-2 text-[0.88rem] font-medium transition-colors">
        <span className="size-2.5 rounded-full" style={{ background: `oklch(0.72 0.16 ${src.hue})` }} /><span className="hidden lg:inline">{src.name}</span><ChevronDown className="size-4 text-t3" />
      </button>
      <IconBtn label="Histórico" active={route === "history"} onClick={() => nav("history")}><History /></IconBtn>
      <IconBtn label="Estatísticas" active={route === "stats"} onClick={() => nav("stats")}><TrendingUp /></IconBtn>
      {!together && <IconBtn label="Ouvir junto" active={route === "together"} onClick={() => nav("together")}><Users /></IconBtn>}
      <IconBtn label="Configurações (Ctrl+,)" active={route.startsWith("settings")} onClick={() => nav("settings/appearance")}><Settings /></IconBtn>
      <button aria-label="Conta" title="Conta" onClick={(e) => openMenuAt(e.currentTarget, [
        { header: true, label: accounts.youtube ? `Conectado como ${accounts.youtube}` : "Não conectado" },
        { label: "Conta", icon: <CircleUser />, onClick: () => nav("account") },
        { label: "Retrospectiva", icon: <Gift />, onClick: () => nav("wrapped") },
        { label: "Configurações", icon: <Settings />, hint: "Ctrl+,", onClick: () => nav("settings/appearance") },
        { label: "Atalhos de teclado", icon: <Keyboard />, hint: "?", onClick: () => openDialog("shortcuts") },
        { divider: true },
        { label: online ? "Simular modo offline" : "Voltar a ficar online", icon: online ? <WifiOff /> : <Wifi />, onClick: () => { setOnline(!online); toast(online ? "Você está offline. Só o conteúdo baixado está disponível." : "Conexão restabelecida"); } },
        ...(accounts.youtube ? [{ divider: true }, { label: "Sair", icon: <LogOut />, danger: true, onClick: () => openDialog("logout") }] : [{ label: "Entrar", icon: <Check />, onClick: () => openDialog("login", { service: "youtube" }) }]),
      ])} className="ml-1 size-9 rounded-full grid place-items-center font-semibold text-accent-fg bg-accent hover:brightness-110 transition-[filter]">
        {accounts.youtube ? accounts.youtube[0].toUpperCase() : <CircleUser className="size-5" />}
      </button>
      <WindowControls />
    </header>
  );
}
