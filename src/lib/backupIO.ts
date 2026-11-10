// Liga o backup puro (lib/backup.ts) às stores e aos diálogos de arquivo.
import { backupName, buildBackup, LIB_KEYS, parseBackup, referencedTrackIds, type BackupFile } from "./backup";
import { getTrack, registerTrack } from "./catalog";
import { invoke, isTauri, pickOpenFile, pickSaveFile } from "./native";
import { SECRET_KEYS, useSettings } from "../store/settings";
import { useLib } from "../store/library";

const filters = [{ name: "Backup do MetroMusic", extensions: ["backup", "json"] }];

/** Escolhe o destino e grava. Devolve o caminho, ou `null` se o usuário cancelou. */
export async function createBackup(): Promise<string | null> {
  if (!isTauri) throw new Error("O backup em arquivo só funciona no app nativo.");
  const path = await pickSaveFile(backupName(), filters);
  if (!path) return null;
  const library: Record<string, any> = useLib.getState();
  const tracks = referencedTrackIds(library).map((id) => getTrack(id)?.ext).filter(Boolean);
  const file = buildBackup({ settings: useSettings.getState().v, library, tracks });
  await invoke("file_write_text", { path, text: JSON.stringify(file) });
  return path;
}

/** Escolhe e valida o arquivo (sem aplicar nada). `null` = cancelou. */
export async function readBackup(): Promise<{ path: string; data: BackupFile } | null> {
  if (!isTauri) throw new Error("A restauração só funciona no app nativo.");
  const path = await pickOpenFile(filters);
  if (!path) return null;
  const text = await invoke<string>("file_read_text", { path });
  const parsed = parseBackup(text ?? "");
  if (!parsed.ok) throw new Error(parsed.error);
  return { path, data: parsed.data };
}

/** Substitui biblioteca e configurações pelas do backup. Sessões de contas e segredos continuam como estavam. */
export function applyBackup(b: BackupFile) {
  for (const t of b.tracks as any[]) { try { registerTrack(t); } catch { /* faixa malformada: ignora */ } }
  const lib: Record<string, unknown> = {};
  for (const k of LIB_KEYS) lib[k] = k in b.library ? b.library[k] : (k === "counts" ? {} : []);
  useLib.setState(lib as any);
  const keep = Object.fromEntries(Object.entries(useSettings.getState().v).filter(([k]) => SECRET_KEYS.includes(k)));
  useSettings.setState({ v: { ...b.settings, ...keep } });
}
