import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import Mini from "./pages/Mini";
import { initAccounts, loginWeb } from "./lib/account";
import { initLastfm } from "./lib/lastfm";
import { initSoundcloud } from "./lib/soundcloud";
import { invoke } from "./lib/native";
import { startBridge } from "./lib/bridge";
import { getPlaylist, loadExternalTracks } from "./lib/catalog";
import { initBackend, usePlayer } from "./store/player";
import { getSetting } from "./store/settings";

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
  initBackend();
  initAccounts();
  initLastfm();
  initSoundcloud();
  if (import.meta.env.DEV && (window as any).__TAURI_INTERNALS__) invoke<boolean>("dev_flag", { name: "MM_AUTOLOGIN" }).then((on) => on && loginWeb());
  root.render(<App />);
  // Em desenvolvimento, `MM_AUTOTEST=1 pnpm tauri dev` roda o teste do fluxo de reprodução e escreve no log.
  if (import.meta.env.DEV) import("./lib/native").then(({ invoke, isTauri }) => isTauri && invoke<boolean>("dev_flag", { name: "MM_AUTOTEST" }).then((on) => on && setTimeout(() => import("./lib/devAutotest").then((m) => m.runAutotest((x) => console.warn("[autotest] " + x))), 3000)));
  if (import.meta.env.DEV) import("./lib/native").then(({ invoke, isTauri }) => isTauri && invoke<boolean>("dev_flag", { name: "MM_AUTOSHOW" }).then((on) => on && setTimeout(() => import("./lib/devAutotest").then((m) => m.runShow((x) => console.warn("[autotest] " + x))), 3000)));
}

// Em desenvolvimento, expõe as stores no console para depuração.
if (import.meta.env.DEV) {
  Promise.all([import("./store/ui"), import("./store/library"), import("./store/settings"), import("./lib/catalog")]).then(([ui, lib, st, cat]) =>
    Object.assign(window, { __ui: ui.useUI, __player: usePlayer, __lib: lib.useLib, __settings: st.useSettings, __catalog: cat,
      // Mede FPS rolando as telas: no console, `await __perf()`.
      __perf: () => import("./lib/perfProbe").then((m) => m.runPerfProbe((x) => console.warn("[perf] " + x))) }));
}


