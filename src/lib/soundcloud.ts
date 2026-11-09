// Sessão do SoundCloud: perfil, curtidas importadas e curtidas devolvidas à conta.
import { create } from "zustand";
import { getTrack, registerTrack } from "./catalog";
import { isImportingLikes, setImportingLikes } from "./account";
import { engine, type ScAccountInfo } from "./engine";
import { isTauri, onEvent } from "./native";
import { useLib } from "../store/library";
import { getSetting } from "../store/settings";
import { toast, useUI } from "../store/ui";

interface LoginEvent { ok: boolean; cancelled: boolean; error?: string | null; account?: ScAccountInfo | null }
interface S { info: ScAccountInfo | null; status: "idle" | "waiting" | "checking"; error: string | null; epoch: number }
const KEY = "metromusic-sc-account-v1";
const saved = (): ScAccountInfo | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } };
export const useSc = create<S>(() => ({ info: saved(), status: "idle", error: null, epoch: 0 }));

function setInfo(info: ScAccountInfo | null) {
  try { info ? localStorage.setItem(KEY, JSON.stringify(info)) : localStorage.removeItem(KEY); } catch { /* sem armazenamento */ }
  useSc.setState((s) => ({ info, status: "idle", error: null, epoch: s.epoch + 1 }));
  useLib.getState().setAccount("soundcloud", info ? info.name : null);
}

export async function importScLikes() {
  if (!isTauri || !useSc.getState().info) return 0;
  const page = await engine.scLibrary("songs");
  const ids = (page?.tracks ?? []).map((t) => registerTrack(t).id);
  setImportingLikes(true);
  try { if (ids.length) useLib.getState().setLiked(ids, true); } finally { setImportingLikes(false); }
  return ids.length;
}

async function onLoggedIn(info: ScAccountInfo) {
  setInfo(info);
  useUI.getState().closeDialog();
  toast(`Conectado ao SoundCloud como ${info.name}`);
  if (getSetting("ytSync") !== false) importScLikes().then((n) => n && toast(`${n} curtidas importadas do SoundCloud`)).catch(() => {});
}

export function loginScWeb() { useSc.setState({ status: "waiting", error: null }); engine.scLoginStart().catch((e) => useSc.setState({ status: "idle", error: String(e) })); }
export function cancelScLogin() { engine.scLoginCancel(); useSc.setState({ status: "idle" }); }
export async function loginScToken(token: string) {
  useSc.setState({ status: "checking", error: null });
  try { const info = await engine.scLoginToken(token); if (info) await onLoggedIn(info); else useSc.setState({ status: "idle" }); }
  catch (e) { useSc.setState({ status: "idle", error: String(e) }); }
}
export async function logoutSc() { await engine.scLogout(); setInfo(null); toast("Você saiu do SoundCloud"); }

export async function initSoundcloud() {
  if (!isTauri) return;
  await onEvent<LoginEvent>("sc:login", (e) => {
    if (e.ok && e.account) onLoggedIn(e.account);
    else useSc.setState({ status: "idle", error: e.cancelled ? null : (e.error ?? "Não foi possível entrar") });
  });
  try {
    const info = await engine.scAccount();
    if (info) { setInfo(info); if (getSetting("ytSync") !== false) importScLikes().catch(() => {}); } else if (useSc.getState().info) setInfo(null);
  } catch { /* sem rede: mantém o guardado */ }
  if (!useSc.getState().info && useLib.getState().accounts.soundcloud) useLib.getState().setAccount("soundcloud", null);

  // curtir aqui = curtir lá
  let prev = new Set(useLib.getState().liked);
  useLib.subscribe((s) => {
    const now = new Set(s.liked);
    if (!isImportingLikes() && useSc.getState().info && getSetting("ytSync") !== false) {
      const scId = (id: string) => { const t = getTrack(id); return t?.ext?.provider === "soundcloud" ? t.ext.id : null; };
      for (const id of now) if (!prev.has(id)) { const v = scId(id); if (v) engine.scRate(v, true)?.catch(() => toast("Não foi possível curtir no SoundCloud")); }
      for (const id of prev) if (!now.has(id)) { const v = scId(id); if (v) engine.scRate(v, false)?.catch(() => toast("Não foi possível remover a curtida no SoundCloud")); }
    }
    prev = now;
  });
}
