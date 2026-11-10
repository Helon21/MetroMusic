import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import Mini from "./pages/Mini";
import { initAccounts, loginWeb } from "./lib/account";
import { initLastfm } from "./lib/lastfm";
import { initSoundcloud } from "./lib/soundcloud";
import { initSpotify } from "./lib/spotify";
import { invoke } from "./lib/native";
import { startBridge } from "./lib/bridge";
import { startScheduler } from "./lib/scheduler";
import { startDiscord } from "./lib/discord";
import { startUpdater } from "./lib/updater";
import { startLocal } from "./lib/local";
import { startPerf } from "./lib/perf";
import { verifyDownloads } from "./lib/downloads";
import { getPlaylist, loadExternalTracks } from "./lib/catalog";
import { initBackend, initHistoryTracker, usePlayer } from "./store/player";
import { getSetting, initSettingsFile } from "./store/settings";
import { useLib } from "./store/library";
import { openDialog } from "./store/ui";

const isMini = new URLSearchParams(location.search).has("mini") || location.hash === "#mini";
// A janela principal lê as configurações do arquivo antes de desenhar qualquer coisa.
if (!isMini) await initSettingsFile();

const root = createRoot(document.getElementById("root")!);

// A mesma interface serve a janela principal e a do mini-player (aberta com ?mini=1).
if (new URLSearchParams(location.search).has("mini") || location.hash === "#mini") {
  document.title = "MetroMusic · Mini";
  root.render(<Mini />);
} else {
  loadExternalTracks();
  // Opções de persistência: sem fila persistente, começa vazio; sem "lembrar", zera aleatório e repetir.
  if (!getSetting("persistentQueue")) usePlayer.setState({ queue: [], index: 0, position: 0 });
  if (!getSetting("rememberShuffleRepeat")) usePlayer.setState({ shuffle: false, repeat: "off" });

  // Primeira execução: deixa uma fila pronta (pausada) para o player não abrir vazio.
  if (!usePlayer.getState().queue.length) {
    const mix = getPlaylist("mix0")!;
    usePlayer.setState({ queue: mix.trackIds, index: 0, queueTitle: mix.title, position: 0 });
  }

  startBridge();
  initHistoryTracker();
  startScheduler();
  startDiscord();
  startUpdater();
  startPerf();
  startLocal();
  verifyDownloads();
  // primeiro uso: mostra como conectar os serviços (some para sempre depois de fechar, ou se já houver conta conectada)
  setTimeout(() => {
    const accounts = useLib.getState().accounts;
    if (!getSetting("onboardingSeen") && !Object.keys(accounts).length) openDialog("welcome");
  }, 900);
  initBackend();
  initAccounts();
  initLastfm();
  initSoundcloud();
  initSpotify();
  if (import.meta.env.DEV && (window as any).__TAURI_INTERNALS__) invoke<boolean>("dev_flag", { name: "MM_AUTOLOGIN" }).then((on) => on && loginWeb());
  root.render(<App />);
  // Em desenvolvimento, `MM_AUTOTEST=1 pnpm tauri dev` roda o teste do fluxo de reprodução e escreve no log.
  if (import.meta.env.DEV) import("./lib/native").then(({ invoke, isTauri }) => isTauri && invoke<boolean>("dev_flag", { name: "MM_AUTOTEST" }).then((on) => on && setTimeout(() => import("./lib/devAutotest").then((m) => m.runAutotest((x) => console.warn("[autotest] " + x))), 3000)));
  if (import.meta.env.DEV) import("./lib/native").then(({ invoke, isTauri }) => isTauri && invoke<boolean>("dev_flag", { name: "MM_AUTOSHOW" }).then((on) => on && setTimeout(() => import("./lib/devAutotest").then((m) => m.runShow((x) => console.warn("[autotest] " + x))), 3000)));
}

// Em desenvolvimento, expõe as stores no console para depuração.
if (import.meta.env.DEV) {
  Promise.all([import("./store/ui"), import("./store/library"), import("./store/settings"), import("./lib/catalog"), import("./lib/lt/session"), import("./lib/updater")]).then(([ui, lib, st, cat, lt, up]) =>
    Object.assign(window, { __ui: ui.useUI, __player: usePlayer, __lib: lib.useLib, __settings: st.useSettings, __catalog: cat, __lt: lt.useLT, __update: up.useUpdate,
      // Mede FPS rolando as telas: no console, `await __perf()`.
      __perf: () => import("./lib/perfProbe").then((m) => m.runPerfProbe((x) => console.warn("[perf] " + x))) }));
}


