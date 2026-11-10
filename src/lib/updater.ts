// Atualização automática pelas Releases do GitHub (plugin oficial do Tauri, com assinatura).
// Funciona como a do Discord: avisa com um mini modal, baixa em segundo plano, troca os arquivos e reinicia o app.
// Sem assistente de instalação ("próximo, próximo"): no Windows a instalação é silenciosa e no Linux o AppImage se troca sozinho.
import { create } from "zustand";
import { isTauri } from "./native";
import { getSetting, setSetting } from "../store/settings";
import { openDialog, toast } from "../store/ui";

export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "restarting" | "error";

interface U {
  status: UpdateStatus;
  current: string; version: string; notes: string; date: string;
  /** 0 a 1; `null` quando o servidor não informa o tamanho. */
  progress: number | null; downloaded: number; total: number;
  error: string;
}

export const useUpdate = create<U>(() => ({ status: "idle", current: "", version: "", notes: "", date: "", progress: null, downloaded: 0, total: 0, error: "" }));

// O objeto `Update` do plugin (tem o método de baixar) fica fora do store: não é dado serializável.
let pending: { downloadAndInstall: (cb: (e: any) => void) => Promise<void> } | null = null;

/** Versão instalada. */
export async function currentVersion(): Promise<string> {
  if (!isTauri) return "";
  const { getVersion } = await import("@tauri-apps/api/app");
  const v = await getVersion();
  useUpdate.setState({ current: v });
  return v;
}

/**
 * Procura uma versão nova. `manual`: foi o usuário que pediu (sempre mostra o resultado);
 * senão só abre o aviso se a opção estiver ligada e a versão não tiver sido dispensada.
 */
export async function checkUpdates(manual: boolean) {
  if (!isTauri) return;
  const s = useUpdate.getState().status;
  if (s === "checking" || s === "downloading" || s === "restarting") return;
  useUpdate.setState({ status: "checking", error: "" });
  try {
    const current = await currentVersion();
    const { check } = await import("@tauri-apps/plugin-updater");
    const u = await check();
    if (!u) {
      useUpdate.setState({ status: "none", current });
      if (manual) toast("Você está na versão mais recente");
      return;
    }
    pending = u as any;
    useUpdate.setState({ status: "available", current, version: u.version, notes: u.body ?? "", date: u.date ?? "", progress: null, downloaded: 0, total: 0 });
    const skipped = getSetting("updateSkipped") === u.version;
    if (manual || (getSetting("updateNotifications") !== false && !skipped)) openDialog("update");
  } catch (e) {
    useUpdate.setState({ status: "error", error: String(e).replace(/^Error: /, "") });
    if (manual) toast(`Não consegui verificar as atualizações: ${useUpdate.getState().error}`);
  }
}

/** Baixa, instala e reinicia. O progresso aparece no aviso. */
export async function installUpdate() {
  if (!pending || useUpdate.getState().status === "downloading") return;
  useUpdate.setState({ status: "downloading", progress: null, downloaded: 0, total: 0, error: "" });
  try {
    await pending.downloadAndInstall((e: any) => {
      if (e.event === "Started") useUpdate.setState({ total: e.data?.contentLength ?? 0 });
      else if (e.event === "Progress") {
        const st = useUpdate.getState(), downloaded = st.downloaded + (e.data?.chunkLength ?? 0);
        useUpdate.setState({ downloaded, progress: st.total ? Math.min(1, downloaded / st.total) : null });
      }
    });
    useUpdate.setState({ status: "restarting", progress: 1 });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    useUpdate.setState({ status: "error", error: String(e).replace(/^Error: /, "") });
    toast(`A atualização não terminou: ${useUpdate.getState().error}`);
  }
}

/** "Pular esta versão": o aviso automático não volta para ela (a verificação manual ainda mostra). */
export function skipVersion() {
  const v = useUpdate.getState().version;
  if (v) setSetting("updateSkipped", v);
}

/** Verifica ao abrir (depois de alguns segundos) e a cada 6 horas, se a opção estiver ligada. */
export function startUpdater() {
  if (!isTauri) return;
  currentVersion();
  const run = () => { if (getSetting("autoUpdateCheck") !== false) checkUpdates(false); };
  setTimeout(run, 12_000);
  setInterval(run, 6 * 60 * 60 * 1000);
}
