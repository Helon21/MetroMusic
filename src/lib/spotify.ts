// Sessão do Spotify (login oficial via WebView + Device Flow): perfil, curtidas importadas e curtidas devolvidas à conta.
import { create } from "zustand";
import { getTrack, registerTrack } from "./catalog";
import { isImportingLikes, setImportingLikes } from "./account";
import { engine, type SpAccountInfo, type SpStatus } from "./engine";
import { isTauri, onEvent } from "./native";
import { useLib } from "../store/library";
import { getSetting } from "../store/settings";
import { toast, useUI } from "../store/ui";

interface LoginEvent { ok: boolean; cancelled: boolean; error?: string | null; account?: SpAccountInfo | null }
interface S { info: SpAccountInfo | null; hasClientId: boolean; redirect: string; status: "idle" | "waiting"; error: string | null; epoch: number }
const KEY = "metromusic-sp-account-v1";
const saved = (): SpAccountInfo | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } };
export const useSp = create<S>(() => ({ info: saved(), hasClientId: false, redirect: "https://open.spotify.com", status: "idle", error: null, epoch: 0 }));

function setInfo(info: SpAccountInfo | null) {
  try { info ? localStorage.setItem(KEY, JSON.stringify(info)) : localStorage.removeItem(KEY); } catch { /* sem armazenamento */ }
  useSp.setState((s) => ({ info, status: "idle", error: null, epoch: s.epoch + 1 }));
  useLib.getState().setAccount("spotify", info ? info.name : null);
}

export async function importSpLikes() {
  if (!isTauri || !useSp.getState().info) return 0;
  const page = await engine.spLibrary("songs");
  const ids = (page?.tracks ?? []).map((t) => registerTrack(t).id);
  setImportingLikes(true);
  try { if (ids.length) useLib.getState().setLiked(ids, true); } finally { setImportingLikes(false); }
  return ids.length;
}

async function onLoggedIn(info: SpAccountInfo) {
  setInfo(info);
  useUI.getState().closeDialog();
  toast(`Conectado ao Spotify como ${info.name}`);
  if (getSetting("ytSync") !== false) importSpLikes().then((n) => n && toast(`${n} curtidas importadas do Spotify`)).catch(() => {});
}

export async function refreshSpStatus() { const st = await engine.spStatus(); if (st) useSp.setState({ hasClientId: st.hasClientId, redirect: st.redirect }); }
export function loginSp(clientId?: string) {
  useSp.setState({ status: "waiting", error: null });
  engine.spLoginStart(clientId).catch((e) => useSp.setState({ status: "idle", error: String(e) }));
}
export function cancelSpLogin() { engine.spLoginCancel(); useSp.setState({ status: "idle" }); }
export async function logoutSp() { await engine.spLogout(); setInfo(null); toast("Você saiu do Spotify"); }

let initialized = false;
export async function initSpotify() {
  if (!isTauri || initialized) return;
  initialized = true;
  await refreshSpStatus();
  await onEvent<LoginEvent>("sp:login", (e) => {
    if (e.ok && e.account) { onLoggedIn(e.account); refreshSpStatus(); }
    else useSp.setState({ status: "idle", error: e.cancelled ? null : (e.error ?? "Não foi possível entrar") });
  });
  try {
    const info = await engine.spAccount();
    if (info) { setInfo(info); if (getSetting("ytSync") !== false) importSpLikes().catch(() => {}); } else if (useSp.getState().info) setInfo(null);
  } catch { /* sem rede: mantém o guardado */ }
  if (!useSp.getState().info && useLib.getState().accounts.spotify) useLib.getState().setAccount("spotify", null);

  // curtir aqui = curtir lá
  let prev = new Set(useLib.getState().liked);
  useLib.subscribe((s) => {
    const now = new Set(s.liked);
    if (!isImportingLikes() && useSp.getState().info && getSetting("ytSync") !== false) {
      const spId = (id: string) => { const t = getTrack(id); return t?.ext?.provider === "spotify" ? t.ext.id : null; };
      for (const id of now) if (!prev.has(id)) { const v = spId(id); if (v) engine.spRate(v, true)?.catch(() => toast("Não foi possível curtir no Spotify")); }
      for (const id of prev) if (!now.has(id)) { const v = spId(id); if (v) engine.spRate(v, false)?.catch(() => toast("Não foi possível remover a curtida no Spotify")); }
    }
    prev = now;
  });
}
