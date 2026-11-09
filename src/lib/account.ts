// Sessão das contas ligadas ao backend (por enquanto, YouTube Music).
import { create } from "zustand";
import { getTrack, registerTrack } from "./catalog";
import { engine, type RPage } from "./engine";
import { isTauri, onEvent } from "./native";
import { getSetting } from "../store/settings";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { toast, useUI } from "../store/ui";

export interface YtAccount { name: string; email?: string | null; handle?: string | null; avatar?: string | null }
interface LoginEvent { ok: boolean; cancelled: boolean; error?: string | null; account?: YtAccount | null }

interface S {
  info: YtAccount | null;
  /** "waiting" = janela do Google aberta; "checking" = validando a sessão */
  status: "idle" | "waiting" | "checking";
  error: string | null;
  /** muda a cada entrada/saída: telas que dependem da conta recarregam */
  epoch: number;
}
let importing = false;
const KEY = "metromusic-yt-account-v1";
const saved = (): YtAccount | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } };
export const useYt = create<S>(() => ({ info: saved(), status: "idle", error: null, epoch: 0 }));

function setInfo(info: YtAccount | null) {
  try { info ? localStorage.setItem(KEY, JSON.stringify(info)) : localStorage.removeItem(KEY); } catch { /* sem armazenamento */ }
  useYt.setState((s) => ({ info, status: "idle", error: null, epoch: s.epoch + 1 }));
  useLib.getState().setAccount("youtube", info ? info.name : null);
}

/** Traz as músicas curtidas da conta para a biblioteca local (só adiciona). */
export async function importLikes() {
  if (!isTauri || !useYt.getState().info) return 0;
  const page = await engine.ytLibrary("songs");
  const ids = (page?.tracks ?? []).map((t) => registerTrack(t).id);
  importing = true;
  try { if (ids.length) useLib.getState().setLiked(ids, true); } finally { importing = false; }
  return ids.length;
}

async function onLoggedIn(info: YtAccount) {
  setInfo(info);
  useUI.getState().closeDialog();
  toast(`Conectado ao YouTube Music como ${info.name}`);
  if (getSetting("ytSync") !== false) importLikes().then((n) => n && toast(`${n} músicas curtidas importadas da conta`)).catch(() => {});
}

export function loginWeb() {
  useYt.setState({ status: "waiting", error: null });
  engine.ytLoginStart().catch((e) => useYt.setState({ status: "idle", error: String(e) }));
}
export function cancelLogin() { engine.ytLoginCancel(); useYt.setState({ status: "idle" }); }

export async function loginCookie(cookie: string) {
  useYt.setState({ status: "checking", error: null });
  try { const info = await engine.ytLoginCookie(cookie); if (info) await onLoggedIn(info); else useYt.setState({ status: "idle" }); }
  catch (e) { useYt.setState({ status: "idle", error: String(e) }); }
}

export async function logout(clearLibrary = false) {
  await engine.ytLogout();
  setInfo(null);
  if (clearLibrary) useLib.setState({ savedPlaylists: [] });
  toast("Você saiu da conta");
}

/** Na abertura: confirma a sessão guardada e escuta o resultado da janela de login. */
export async function initAccounts() {
  if (!isTauri) return;
  await onEvent<LoginEvent>("yt:login", (e) => {
    if (e.ok && e.account) onLoggedIn(e.account);
    else useYt.setState({ status: "idle", error: e.cancelled ? null : (e.error ?? "Não foi possível entrar") });
  });
  syncLikesAndHistory();
  try {
    const info = await engine.ytAccount();
    if (info) {
      setInfo(info);
      // traz as curtidas da conta a cada abertura (a lista local só recebia as da hora do login)
      if (getSetting("ytSync") !== false) importLikes().catch(() => {});
    } else if (useYt.getState().info) setInfo(null);
  } catch { /* sem rede: mantém o que estava guardado */ }
  // o estado de teste herdado ("cadu") não vale mais: só existe conta com sessão real
  if (!useYt.getState().info && useLib.getState().accounts.youtube) useLib.getState().setAccount("youtube", null);
}

export type { RPage };

const ytId = (id: string) => { const t = getTrack(id); return t?.ext?.provider === "youtube" ? t.ext.id : null; };

/** Curtidas locais viram curtidas na conta; o que se ouve entra no histórico oficial do YouTube Music. */
function syncLikesAndHistory() {
  const logged = () => !!useYt.getState().info && getSetting("ytSync") !== false;
  let prev = new Set(useLib.getState().liked);
  useLib.subscribe((s) => {
    const now = new Set(s.liked);
    if (!importing && logged()) {
      for (const id of now) if (!prev.has(id)) { const v = ytId(id); if (v) engine.ytRate(v, true)?.catch(() => toast("Não foi possível curtir na conta do YouTube Music")); }
      for (const id of prev) if (!now.has(id)) { const v = ytId(id); if (v) engine.ytRate(v, false)?.catch(() => toast("Não foi possível remover a curtida na conta")); }
    }
    prev = now;
  });
  // Marca como ouvida depois de 30 s (ou metade, em faixas curtas), uma vez por reprodução.
  const done = new Set<string>();
  onEvent<{ token: number; position: number; duration?: number }>("audio:position", (p) => {
    if (!useYt.getState().info || getSetting("pauseHistory")) return;
    const P = usePlayer.getState(); const id = P.queue[P.index]; const v = id && ytId(id);
    if (!v || !p.duration || p.position < Math.min(30, p.duration * 0.5)) return;
    const k = `${p.token}:${v}`;
    if (done.has(k)) return;
    done.add(k);
    if (done.size > 200) done.clear();
    engine.ytMarkPlayed(v, p.position)?.catch((e) => console.warn("histórico do YouTube Music:", e));
  });
}
