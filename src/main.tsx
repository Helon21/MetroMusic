import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import Mini from "./pages/Mini";
import { startBridge } from "./lib/bridge";
import { getPlaylist } from "./lib/catalog";
import { usePlayer } from "./store/player";
import { getSetting } from "./store/settings";

const root = createRoot(document.getElementById("root")!);

// A mesma interface serve a janela principal e a do mini-player (aberta com ?mini=1).
if (new URLSearchParams(location.search).has("mini") || location.hash === "#mini") {
  document.title = "MetroMusic · Mini";
  root.render(<Mini />);
} else {
  // Opções de persistência: sem fila persistente, começa vazio; sem "lembrar", zera aleatório e repetir.
  if (!getSetting("persistentQueue")) usePlayer.setState({ queue: [], index: 0, position: 0 });
  if (!getSetting("rememberShuffleRepeat")) usePlayer.setState({ shuffle: false, repeat: "off" });

  // Primeira execução: deixa uma fila pronta (pausada) para o player não abrir vazio.
  if (!usePlayer.getState().queue.length) {
    const mix = getPlaylist("mix0")!;
    usePlayer.setState({ queue: mix.trackIds, index: 0, queueTitle: mix.title, position: 0 });
  }

  startBridge();
  root.render(<App />);
}

// Em desenvolvimento, expõe as stores no console para depuração.
if (import.meta.env.DEV) {
  Promise.all([import("./store/ui"), import("./store/library"), import("./store/settings")]).then(([ui, lib, st]) =>
    Object.assign(window, { __ui: ui.useUI, __player: usePlayer, __lib: lib.useLib, __settings: st.useSettings,
      // Mede FPS rolando as telas: no console, `await __perf()`.
      __perf: () => import("./lib/perfProbe").then((m) => m.runPerfProbe((x) => console.warn("[perf] " + x))) }));
}

