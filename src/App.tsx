import { useEffect, useLayoutEffect, useRef } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { CrashScreen, ErrorBoundary } from "./components/Crash";
import { CommandPalette, ContextMenu, SelectionBar, Toasts } from "./components/overlays";
import { NowPlaying, PlayerBar, RightPanel } from "./components/player";
import { Sidebar, TopBar } from "./components/shell";
import { PALETTES } from "./lib/settingsSchema";
import { cx } from "./lib/util";
import { Dialogs, renderRoute } from "./pages/routes";
import { useLib } from "./store/library";
import { currentTrack, useCurrent, usePlayer } from "./store/player";
import { getSetting, setSetting, useSetting } from "./store/settings";
import { nav, openDialog, scrollMemo, toast, useRoute, useUI } from "./store/ui";

/** Aplica tema, paleta e densidade no elemento raiz. */
function useTheme() {
  const mode = useSetting<string>("themeMode"), black = useSetting<boolean>("pureBlack"), palette = useSetting<string>("palette");
  const density = useSetting<string>("density"), reduce = useSetting<boolean>("reduceMotion");
  const track = useCurrent();
  useEffect(() => {
    const el = document.documentElement;
    const mq = matchMedia("(prefers-color-scheme: light)");
    const apply = () => (el.dataset.theme = mode === "system" ? (mq.matches ? "light" : "dark") : mode);
    apply(); mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.black = String(black); el.dataset.density = density; el.dataset.reduceMotion = String(reduce);
    const p = PALETTES.find((x) => x[0] === palette) ?? PALETTES[4];
    el.style.setProperty("--h", String(p[2] < 0 ? (track?.hue ?? 295) : p[2]));
    el.style.setProperty("--c", String(p[3]));
  }, [black, palette, density, reduce, track?.hue]);
  return reduce;
}

/** Relógio do simulador de reprodução e dos downloads. */
function useClock() {
  useEffect(() => {
    let last = performance.now();
    const a = setInterval(() => { const now = performance.now(); usePlayer.getState().tick((now - last) / 1000); last = now; }, 100);
    const b = setInterval(() => useLib.getState().tickDownloads(), 450);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const U = useUI.getState(), P = usePlayer.getState();
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        if (U.menu) return U.closeMenu(); if (U.dialog) return U.closeDialog(); if (U.palette) return U.setPalette(false);
        if (typing) return el.blur(); if (U.nowPlaying) return U.setNowPlaying(false); if (U.sel.length) return U.setSel([]);
        return;
      }
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); return U.setPalette(!U.palette); }
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); U.setNowPlaying(false); return void window.dispatchEvent(new Event("focus-search")); }
      if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); return U.toggleSidebar(); }
      if (mod && e.key === ",") { e.preventDefault(); return nav("settings/appearance"); }
      if (mod && e.key === "ArrowRight") { e.preventDefault(); return P.next(); }
      if (mod && e.key === "ArrowLeft") { e.preventDefault(); return P.prev(); }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); return U.back(); }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); return U.fwd(); }
      if (typing || mod || e.altKey || U.dialog || U.palette) return;
      if (mod && e.key.toLowerCase() === "a") return;
      const seekStep = getSetting<boolean>("seekAddUp") ? 10 : 5;
      switch (e.key) {
        case " ": e.preventDefault(); return P.toggle();
        case "ArrowRight": return P.seek(P.position + seekStep);
        case "ArrowLeft": return P.seek(P.position - seekStep);
        case "ArrowUp": e.preventDefault(); return P.setVolume(P.volume + 0.05);
        case "ArrowDown": e.preventDefault(); return P.setVolume(P.volume - 0.05);
        case "m": case "M": return P.toggleMute();
        case "s": case "S": return P.toggleShuffle();
        case "r": case "R": return P.cycleRepeat();
        case "l": case "L": { const t = currentTrack(); return t && useLib.getState().toggleLike(t.id); }
        case "f": case "F": return U.setNowPlaying(!U.nowPlaying);
        case "q": case "Q": return U.togglePanel("queue");
        case "y": case "Y": return U.togglePanel("lyrics");
        case "?": return openDialog("shortcuts");
      }
    };
    // O menu nativo do webview não faz sentido num app; os nossos menus tratam o clique direito.
    const noMenu = (e: MouseEvent) => { const el = e.target as HTMLElement; if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") e.preventDefault(); };
    window.addEventListener("keydown", onKey); window.addEventListener("contextmenu", noMenu);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("contextmenu", noMenu); };
  }, []);
}

function Shell() {
  const reduce = useTheme();
  useClock(); useShortcuts();
  const crash = useUI((s) => s.crash);
  // Aviso de nova versão, uma vez por versão (equivalente ao diálogo de atualização do MetroFuse).
  useEffect(() => {
    const t = setTimeout(() => {
      if (getSetting("autoUpdateCheck") && getSetting("updateNotifications") && !getSetting("updateToastSeen")) {
        setSetting("updateToastSeen", true);
        toast("MetroMusic 0.2.0 está disponível", { label: "Ver", fn: () => openDialog("update") });
      }
    }, 7000);
    return () => clearTimeout(t);
  }, []);
  const route = useRoute(), idx = useUI((s) => s.idx);
  const galaxy = useSetting<string>("appBackground") === "galaxy";
  const main = useRef<HTMLDivElement>(null);
  const prev = useRef(idx);
  // Guarda a rolagem da entrada que está saindo e restaura a da que está entrando.
  useLayoutEffect(() => {
    const el = main.current; if (!el) return;
    el.scrollTop = scrollMemo.get(idx) ?? 0;
    prev.current = idx;
  }, [idx, route]);
  useEffect(() => {
    if (useUI.getState().stack.length === 1 && useUI.getState().stack[0] === "home") { const d = getSetting<string>("defaultTab"); if (d !== "home") useUI.getState().replace(d); }
    // Largura pequena: recolhe a barra lateral sozinha.
    const onResize = () => { if (innerWidth < 1060 && !useUI.getState().sidebarCollapsed) useUI.getState().toggleSidebar(); };
    onResize(); window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"}>
      <div className={cx("h-full flex flex-col", galaxy && "galaxy")}>
        <div className="flex-1 min-h-0 flex">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col relative">
            <TopBar />
            <div className="flex-1 min-h-0 flex relative">
              <div ref={main} id="main-scroll" className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden" onScroll={(e) => scrollMemo.set(prev.current, e.currentTarget.scrollTop)}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.main key={route.startsWith("settings/") ? "settings" : route + idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="min-h-full">
                    {renderRoute(route)}
                  </motion.main>
                </AnimatePresence>
              </div>
              <SelectionBar />
              <RightPanel />
            </div>
          </div>
        </div>
        <PlayerBar />
      </div>
      <NowPlaying />
      <CommandPalette />
      <Dialogs />
      <ContextMenu />
      <Toasts />
      {crash && <CrashScreen log={crash} onClose={() => useUI.setState({ crash: null })} />}
    </MotionConfig>
  );
}

export default function App() {
  return <ErrorBoundary><Shell /></ErrorBoundary>;
}
