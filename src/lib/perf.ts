// Desempenho visual: com GPU boa o app mostra todos os efeitos; sem GPU (ou se perceber lentidão) passa sozinho para o
// modo leve, que desliga desfoques, sombras grandes, animações decorativas e vídeos de fundo.
// "Automático" decide por duas pistas: o renderizador de WebGL ser de software e a taxa de quadros real.
import { create } from "zustand";
import { FrameMonitor, hintIsFresh, isSoftwareRenderer } from "./perfDetect";
import { getSetting, setSetting, useSettings } from "../store/settings";

export type PerfMode = "auto" | "full" | "low";

export const usePerf = create<{ low: boolean; reason: string }>(() => ({ low: false, reason: "" }));

/** `true` quando o modo leve está valendo. */
export const useLowPerf = () => usePerf((s) => s.low);
export const isLowPerf = () => usePerf.getState().low;

function apply(low: boolean, reason: string) {
  usePerf.setState({ low, reason });
  document.documentElement.dataset.perf = low ? "low" : "full";
}

/** Nome do renderizador de WebGL (placa de vídeo ou software). `null` se o WebGL não está disponível. */
export function gpuRenderer(): string | null {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch { return null; }
}

let started = false, rafId = 0, monitor = new FrameMonitor();
const STARTUP_GRACE_MS = 8000; // a abertura do app tem picos que não dizem nada sobre a GPU

function stopMonitor() { cancelAnimationFrame(rafId); rafId = 0; }

function startMonitor() {
  stopMonitor();
  monitor = new FrameMonitor();
  let last = 0;
  const tick = (t: number) => {
    const ignore = document.hidden || !document.hasFocus() || t < STARTUP_GRACE_MS;
    if (last && monitor.push(t - last, ignore)) {
      stopMonitor();
      apply(true, "taxa de quadros baixa");
      setSetting("perfHint", { low: true, at: Date.now() });
      return;
    }
    last = t;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function evaluate() {
  const mode = (String(getSetting("visualPerformance") ?? "auto") as PerfMode);
  stopMonitor();
  if (mode === "low") return apply(true, "escolha do usuário");
  if (mode === "full") return apply(false, "escolha do usuário");
  // automático
  const name = gpuRenderer();
  if (isSoftwareRenderer(name)) return apply(true, `sem GPU (${name})`);
  if (hintIsFresh(getSetting("perfHint") as { low: boolean; at: number } | undefined)) { apply(true, "lentidão numa execução anterior"); return; }
  apply(false, name ? `GPU: ${name}` : "GPU desconhecida");
  startMonitor();
}

/** Liga a detecção. Chamado uma vez, na janela principal. */
export function startPerf() {
  if (started) return;
  started = true;
  evaluate();
  let key = String(getSetting("visualPerformance") ?? "auto");
  useSettings.subscribe(() => { const k = String(getSetting("visualPerformance") ?? "auto"); if (k !== key) { key = k; if (k === "auto") setSetting("perfHint", null); evaluate(); } });
  // janela escondida ou sem foco: as animações pausam (poupa CPU e bateria em qualquer PC)
  const idle = () => { document.documentElement.dataset.idle = document.hidden || !document.hasFocus() ? "1" : ""; };
  document.addEventListener("visibilitychange", idle); window.addEventListener("blur", idle); window.addEventListener("focus", idle); idle();
}
