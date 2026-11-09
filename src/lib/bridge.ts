// Ponte entre a janela principal (dona do estado do player) e o resto do sistema:
// mini-player, bandeja, mídia do sistema, atalhos globais, notificações e inicialização.

import { DEFAULTS } from "./settingsSchema";
import { albumOf, artistOf, getTrack } from "./catalog";
import { currentWindow, emitEvent, invoke, isTauri, onEvent } from "./native";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { getSetting, useSettings } from "../store/settings";

/** Resumo do que o mini-player precisa para se desenhar. */
export interface Snap {
  id: string; title: string; artist: string; album: string; hue: number; seed: number;
  duration: number; position: number; playing: boolean; liked: boolean; speed: number; explicit: boolean;
}

function snap(): Snap | null {
  const p = usePlayer.getState();
  const t = getTrack(p.queue[p.index]);
  if (!t) return null;
  return {
    id: t.id, title: t.title, artist: artistOf(t), album: albumOf(t), hue: t.hue, seed: t.seed, duration: t.duration,
    position: p.position, playing: p.playing, liked: useLib.getState().liked.includes(t.id), speed: p.speed, explicit: t.explicit,
  };
}

function nativeUpdate() {
  const s = snap();
  invoke("update_now_playing", {
    title: s?.title ?? "", artist: s?.artist ?? "", album: s?.album ?? "", duration: s?.duration ?? 0,
    position: s?.position ?? 0, playing: s?.playing ?? false, media: !!getSetting("systemMedia"),
  });
}

async function notifyTrack() {
  const s = snap();
  if (!isTauri || !s || !s.playing || !getSetting("trackNotifications") || document.hasFocus()) return;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let ok = await n.isPermissionGranted();
    if (!ok) ok = (await n.requestPermission()) === "granted";
    if (ok) n.sendNotification({ title: s.title, body: s.artist });
  } catch (e) { console.warn("notificação indisponível:", e); }
}

/** Teclas de mídia e atalhos globais. No Wayland puro o sistema pode recusar o registro. */
async function syncShortcuts() {
  if (!isTauri) return;
  try {
    const gs = await import("@tauri-apps/plugin-global-shortcut");
    await gs.unregisterAll();
    const reg = async (key: string, run: () => void) => {
      try { await gs.register(key, (e) => { if (e.state === "Pressed") run(); }); }
      catch (e) { console.warn("atalho global indisponível:", key, e); }
    };
    const P = () => usePlayer.getState();
    // Com os controles de mídia do sistema ligados (MPRIS, SMTC, Now Playing) o próprio sistema entrega
    // as teclas; registrar de novo as dispararia duas vezes. No Linux o registro por atalho nem existe.
    const linux = /Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
    if (getSetting("mediaKeys") && !getSetting("systemMedia") && !linux) {
      await reg("MediaPlayPause", () => P().toggle());
      await reg("MediaTrackNext", () => P().next());
      await reg("MediaTrackPrevious", () => P().prev());
    }
    if (getSetting("globalShortcuts")) {
      await reg("CommandOrControl+Alt+Space", () => P().toggle());
      await reg("CommandOrControl+Alt+Right", () => P().next());
      await reg("CommandOrControl+Alt+Left", () => P().prev());
    }
  } catch (e) { console.warn("atalhos globais indisponíveis:", e); }
}

async function syncAutostart() {
  if (!isTauri) return;
  try {
    const a = await import("@tauri-apps/plugin-autostart");
    const want = !!getSetting("launchAtLogin"), has = await a.isEnabled();
    if (want && !has) await a.enable();
    if (!want && has) await a.disable();
  } catch (e) { console.warn("iniciar com o sistema indisponível:", e); }
}

let started = false;
/** Liga tudo. Chamado uma vez, só na janela principal. */
export function startBridge() {
  if (started) return;
  started = true;

  let lastKey = "", lastPush = 0;
  const push = () => { lastPush = Date.now(); emitEvent("mm:state", snap()); };

  // Posição chega a 10 Hz; só repassamos mudanças relevantes e uma amostra por segundo.
  usePlayer.subscribe((s, prev) => {
    const id = s.queue[s.index];
    const key = `${id}|${s.playing}|${s.speed}|${s.buffering}`;
    const seeked = Math.abs(s.position - prev.position) > 1.5;
    if (key === lastKey && !seeked && Date.now() - lastPush < 1000) return;
    const trackChanged = !lastKey.startsWith(`${id}|`);
    const changed = key !== lastKey;
    lastKey = key;
    push();
    if (changed || seeked) nativeUpdate();
    if (trackChanged) notifyTrack();
  });
  useLib.subscribe((s, prev) => { if (s.liked !== prev.liked) push(); });

  onEvent<{ type: string; value?: number }>("mm:cmd", ({ type, value }) => {
    const P = usePlayer.getState();
    switch (type) {
      case "toggle": return P.toggle();
      case "play": if (!P.playing) P.toggle(); return;
      case "pause": if (P.playing) P.toggle(); return;
      case "next": return P.next();
      case "prev": return P.prev();
      case "seek": if (typeof value === "number") P.seek(value); return;
      case "like": { const id = P.queue[P.index]; if (id) useLib.getState().toggleLike(id); return; }
    }
  });
  onEvent("mm:hello", push);

  // Configurações que o sistema precisa saber.
  const get = (k: string) => { const v = useSettings.getState().v; return k in v ? v[k] : DEFAULTS[k]; };
  const watched = ["closeToTray", "mediaKeys", "globalShortcuts", "launchAtLogin", "systemMedia"];
  let lastCfg = JSON.stringify(watched.map(get));
  useSettings.subscribe(() => {
    const cfg = JSON.stringify(watched.map(get));
    if (cfg === lastCfg) return;
    const [ct, mk, gs, ll, sm] = JSON.parse(cfg), [oct, omk, ogs, oll, osm] = JSON.parse(lastCfg);
    lastCfg = cfg;
    if (ct !== oct) invoke("set_close_to_tray", { enabled: !!ct });
    if (mk !== omk || gs !== ogs) syncShortcuts();
    if (ll !== oll) syncAutostart();
    if (sm !== osm) nativeUpdate();
  });

  invoke("set_close_to_tray", { enabled: !!getSetting("closeToTray") });
  syncShortcuts();
  if (getSetting("launchAtLogin")) syncAutostart();
  nativeUpdate();
  if (isTauri && getSetting("startMinimized")) currentWindow().then((w) => w.minimize());
}
