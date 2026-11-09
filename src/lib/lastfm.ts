// Last.fm: sessão, "Tocando agora", scrobble e Loved. A lógica de quando scrobblar é a do `ScrobbleManager` (MetroFuse):
// só músicas maiores que o mínimo, depois de `percentual` da duração ou do atraso máximo (o que vier primeiro),
// contando só o tempo realmente tocado (pausar congela o relógio).
import { create } from "zustand";
import { getTrack } from "./catalog";
import { isImportingLikes } from "./account";
import { isTauri, invoke } from "./native";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { getSetting } from "../store/settings";
import { toast, useUI } from "../store/ui";

interface Status { username: string | null; hasKeys: boolean }
interface S { username: string | null; hasKeys: boolean; busy: boolean; error: string | null }
export const useLastfm = create<S>(() => ({ username: null, hasKeys: false, busy: false, error: null }));

const call = <T = unknown>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);

export async function refreshLastfm() {
  const st = await call<Status>("lastfm_status");
  if (st) {
    useLastfm.setState({ username: st.username, hasKeys: st.hasKeys });
    useLib.getState().setAccount("lastfm", st.username);
  }
}

export async function loginLastfm(username: string, password: string, apiKey?: string, secret?: string) {
  useLastfm.setState({ busy: true, error: null });
  try {
    const name = await call<string>("lastfm_login", { apiKey: apiKey || null, secret: secret || null, username, password });
    useLastfm.setState({ username: name ?? username, hasKeys: true, busy: false });
    useLib.getState().setAccount("lastfm", name ?? username);
    useUI.getState().closeDialog();
    toast(`Conectado ao Last.fm como ${name ?? username}`);
  } catch (e) { useLastfm.setState({ busy: false, error: String(e) }); }
}

export async function logoutLastfm() {
  await call("lastfm_logout");
  useLastfm.setState({ username: null });
  useLib.getState().setAccount("lastfm", null);
  toast("Desconectado do Last.fm");
}

const artistLine = (id: string) => getTrack(id)?.ext?.artists.join(", ") ?? "";

/** Liga o scrobbler ao player e as curtidas ao Loved. Chamar uma vez, na abertura. */
export async function initLastfm() {
  if (!isTauri) return;
  await refreshLastfm();
  const logged = () => !!useLastfm.getState().username && getSetting("lastfmScrobble") !== false;
  const warn = (what: string) => (e: unknown) => console.warn(`Last.fm (${what}):`, e);

  let cur: string | null = null, startedAt = 0, remaining = 0, timerAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = (id: string) => {
    timer = undefined; remaining = 0;
    const t = getTrack(id); if (!t?.ext || !logged()) return;
    call("lastfm_scrobble", { artist: artistLine(id), track: t.ext.title, timestamp: startedAt, album: t.ext.album ?? null, duration: t.duration || null }).catch(warn("scrobble"));
  };
  const arm = (id: string) => { clearTimeout(timer); if (remaining <= 0) return; timerAt = Date.now(); timer = setTimeout(() => fire(id), remaining); };
  const freeze = () => { if (timer) { clearTimeout(timer); timer = undefined; remaining = Math.max(0, remaining - (Date.now() - timerAt)); } };

  const sync = () => {
    const s = usePlayer.getState();
    const id = s.queue[s.index];
    const t = id ? getTrack(id) : undefined;
    const running = s.playing && !s.buffering;
    if (!t?.ext) { freeze(); cur = null; return; }
    if (id !== cur) {
      // faixa nova
      freeze(); clearTimeout(timer); cur = id; startedAt = Math.floor(Date.now() / 1000); remaining = 0;
      if (!running) return;
      beginTrack(id);
      return;
    }
    if (running) { if (!timer && remaining > 0) arm(id); } else freeze();
  };
  const beginTrack = (id: string) => {
    const t = getTrack(id)!;
    if (!logged()) return;
    if (getSetting("lastfmNowPlaying") !== false) call("lastfm_now_playing", { artist: artistLine(id), track: t.ext!.title, album: t.ext!.album ?? null, duration: t.duration || null }).catch(warn("tocando agora"));
    const min = Number(getSetting("scrobbleMinDuration") ?? 30), pct = Number(getSetting("scrobblePercent") ?? 50) / 100, maxMin = Number(getSetting("scrobbleMinutes") ?? 4);
    if (t.duration <= min) return;
    remaining = Math.min(t.duration * 1000 * pct, maxMin * 60_000);
    arm(id);
  };
  // se a faixa já estava tocando antes de o scrobbler ligar, não há início a registrar: só acompanha
  usePlayer.subscribe((s, p) => { if (s.queue[s.index] !== p.queue[p.index] || s.playing !== p.playing || s.buffering !== p.buffering) sync(); });
  sync();

  // curtir aqui = Loved lá
  let prev = new Set(useLib.getState().liked);
  useLib.subscribe((s) => {
    const now = new Set(s.liked);
    if (!isImportingLikes() && logged() && getSetting("lastfmLikes")) {
      for (const id of now) if (!prev.has(id)) { const t = getTrack(id); if (t?.ext) call("lastfm_love", { artist: artistLine(id), track: t.ext.title, love: true }).catch(warn("love")); }
      for (const id of prev) if (!now.has(id)) { const t = getTrack(id); if (t?.ext) call("lastfm_love", { artist: artistLine(id), track: t.ext.title, love: false }).catch(warn("unlove")); }
    }
    prev = now;
  });
}
