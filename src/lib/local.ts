// Biblioteca local: varre as pastas escolhidas, registra as faixas e mantém tudo atualizado.
import { registerTrack, type ExtInfo } from "./catalog";
import { engine, type LocalTrack, type ScanResult } from "./engine";
import { fileUrl, isTauri, onEvent, pickFolder } from "./native";
import { getSetting, useSettings } from "../store/settings";
import { useLib } from "../store/library";
import { toast } from "../store/ui";

/** Faixa do arquivo → o que o app usa para tocá-la (`provider: "local"`, `id` = caminho). */
export function localExt(t: LocalTrack): ExtInfo {
  return { provider: "local", id: t.path, title: t.title, artists: t.artists, album: t.album ?? null, durationMs: t.durationMs ?? null, artworkUrl: t.cover ? fileUrl(t.cover) : null };
}

/** Registra o resultado de uma varredura e troca a lista "Arquivos locais" por ele. */
export function applyScan(r: ScanResult) {
  const ids = r.tracks.map((t) => registerTrack(localExt(t), false).id); // fora do armazenamento do navegador: o índice fica em disco
  useLib.setState({ localFiles: ids });
  return ids.length;
}

/** Resumo para o aviso depois de varrer. */
export function scanSummary(r: ScanResult): string {
  const parts = [`${r.tracks.length} ${r.tracks.length === 1 ? "música local encontrada" : "músicas locais encontradas"}`];
  if (r.unsupported) parts.push(`${r.unsupported} Opus/AIFF/WMA ignorados (o player ainda não os lê)`);
  if (r.tooShort) parts.push(`${r.tooShort} muito curtos`);
  if (r.unreadable) parts.push(`${r.unreadable} ilegíveis`);
  return parts.join(" · ");
}

let scanning = false;
export async function scanLocal(quiet = false) {
  if (!isTauri) { if (!quiet) toast("A varredura só funciona no app nativo"); return; }
  const folders = useLib.getState().folders;
  if (!folders.length) { applyScan({ tracks: [], unsupported: 0, unreadable: 0, tooShort: 0 }); if (!quiet) toast("Adicione uma pasta primeiro"); return; }
  if (scanning) return;
  scanning = true;
  if (!quiet) toast("Varrendo pastas de música…");
  try {
    const r = await engine.localScan(folders, Number(getSetting("minDuration")) || 0, getSetting("preferEmbeddedArt") !== false);
    if (r) { applyScan(r); if (!quiet) toast(scanSummary(r)); }
  } catch (e) { toast(`Não consegui varrer as pastas: ${e}`); }
  finally { scanning = false; }
}

export async function addFolder() {
  const dir = await pickFolder();
  if (!dir) return;
  const cur = useLib.getState().folders;
  if (cur.includes(dir)) return void toast("Essa pasta já está na lista");
  useLib.getState().setFolders([...cur, dir]);
  await scanLocal();
}
export async function removeFolder(dir: string) {
  useLib.getState().setFolders(useLib.getState().folders.filter((x) => x !== dir));
  await scanLocal(true);
}

/** Ao abrir: mostra a biblioteca da última varredura, varre de novo se pedido, e vigia as pastas. */
export async function startLocal() {
  if (!isTauri) return;
  try { const idx = await engine.localIndex(); if (idx) applyScan(idx); } catch { /* sem índice ainda */ }
  if (getSetting("scanOnStart")) scanLocal(true);
  let watchKey = "";
  const sync = () => {
    const folders = useLib.getState().folders, on = getSetting("watchFolders") !== false;
    const key = on ? folders.join("\n") : "";
    if (key === watchKey) return;
    watchKey = key;
    engine.localWatch(on ? folders : [])?.catch((e) => console.warn("vigia das pastas:", e));
  };
  sync();
  useLib.subscribe(sync); useSettings.subscribe(sync);
  let t: ReturnType<typeof setTimeout> | undefined;
  await onEvent("local:changed", () => { clearTimeout(t); t = setTimeout(() => scanLocal(true), 800); });
}
