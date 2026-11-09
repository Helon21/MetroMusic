// Camada fina sobre o Tauri. Fora do Tauri (navegador, testes) as chamadas viram
// no-ops e os eventos passam por BroadcastChannel, então a interface roda igual.

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent) && !/iPhone|iPad/i.test(navigator.userAgent);
/** Mac nativo usa os botões do sistema sobrepostos à interface; Windows e Linux usam os nossos. */
export const hasOwnControls = isTauri && !isMac;
export const isNativeMac = isTauri && isMac;

const chan = !isTauri && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("metromusic") : null;

export async function emitEvent(name: string, payload: unknown = {}) {
  if (isTauri) { const { emit } = await import("@tauri-apps/api/event"); return emit(name, payload); }
  chan?.postMessage({ name, payload });
}

export async function onEvent<T>(name: string, cb: (payload: T) => void): Promise<() => void> {
  if (isTauri) { const { listen } = await import("@tauri-apps/api/event"); return listen<T>(name, (e) => cb(e.payload)); }
  if (!chan) return () => {};
  const h = (e: MessageEvent) => { if (e.data?.name === name) cb(e.data.payload); };
  chan.addEventListener("message", h);
  return () => chan.removeEventListener("message", h);
}

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauri) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/** Abre ou fecha o mini-player. Devolve `true` se ele ficou aberto. */
export async function toggleMiniWindow(onTop: boolean): Promise<boolean> {
  if (isTauri) return (await invoke<boolean>("toggle_mini", { onTop })) ?? false;
  return !!window.open("/?mini=1", "metromusic-mini", "popup,width=380,height=132");
}

export async function closeThisWindow() {
  if (isTauri) return (await currentWindow()).close();
  window.close();
}
