// Backup e restauração: playlists, curtidas, histórico, estatísticas e configurações num arquivo JSON.
// Funções puras (sem store nem Tauri) para testar com `node --test scripts/tests`.
// Segredos (chave da IA, senha do proxy) e sessões de contas **nunca** entram no arquivo.

export const BACKUP_VERSION = 1;
export const BACKUP_APP = "MetroMusic";
/** Partes da biblioteca que viajam no backup (downloads, cache e arquivos locais dependem do disco e ficam de fora). */
export const LIB_KEYS = ["liked", "savedAlbums", "followed", "savedPlaylists", "subscribedPodcasts", "later", "playlists", "pins", "history", "searchHistory", "recognitions", "counts", "folders"] as const;
const SECRETS = ["aiKey", "proxyPass"];

export interface BackupFile {
  app: string; version: number; createdAt: string;
  settings: Record<string, unknown>;
  library: Record<string, unknown>;
  /** Metadados das faixas citadas (título, artista, capa…), para a biblioteca restaurada não ficar só com ids. */
  tracks: unknown[];
}

export function buildBackup(input: { settings: Record<string, unknown>; library: Record<string, any>; tracks: unknown[]; now?: Date }): BackupFile {
  const settings = Object.fromEntries(Object.entries(input.settings).filter(([k]) => !SECRETS.includes(k)));
  const library = Object.fromEntries(LIB_KEYS.filter((k) => k in input.library).map((k) => [k, input.library[k]]));
  return { app: BACKUP_APP, version: BACKUP_VERSION, createdAt: (input.now ?? new Date()).toISOString(), settings, library, tracks: input.tracks };
}

export type Parsed = { ok: true; data: BackupFile } | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export function parseBackup(text: string): Parsed {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return { ok: false, error: "O arquivo não é um backup válido (JSON ilegível)." }; }
  if (!isObj(j) || j.app !== BACKUP_APP) return { ok: false, error: "Este arquivo não é um backup do MetroMusic." };
  if (typeof j.version !== "number" || j.version > BACKUP_VERSION) return { ok: false, error: "O backup é de uma versão mais nova do app. Atualize o MetroMusic para restaurá-lo." };
  if (!isObj(j.settings) || !isObj(j.library) || !Array.isArray(j.tracks)) return { ok: false, error: "O backup está incompleto." };
  const lib = j.library as Record<string, unknown>;
  for (const k of ["liked", "savedAlbums", "followed", "savedPlaylists", "subscribedPodcasts", "later", "playlists", "pins", "history", "searchHistory", "recognitions", "folders"]) {
    if (k in lib && !Array.isArray(lib[k])) return { ok: false, error: `O backup está corrompido (“${k}” inválido).` };
  }
  if ("counts" in lib && !isObj(lib.counts)) return { ok: false, error: "O backup está corrompido (“counts” inválido)." };
  const settings = Object.fromEntries(Object.entries(j.settings).filter(([k]) => !SECRETS.includes(k)));
  const library = Object.fromEntries(Object.entries(lib).filter(([k]) => (LIB_KEYS as readonly string[]).includes(k)));
  return { ok: true, data: { app: BACKUP_APP, version: j.version, createdAt: String(j.createdAt ?? ""), settings, library, tracks: j.tracks } };
}

/** Nome sugerido: MetroMusic-2026-11-10.backup */
export const backupName = (d = new Date()) => `MetroMusic-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.backup`;

/** Faixas citadas na biblioteca (ids "provedor:id"): só essas têm metadados a guardar. */
export function referencedTrackIds(library: Record<string, any>): string[] {
  const ids = new Set<string>();
  for (const k of ["liked", "later"]) for (const i of library[k] ?? []) ids.add(i);
  for (const p of library.playlists ?? []) for (const i of p.trackIds ?? []) ids.add(i);
  for (const h of library.history ?? []) ids.add(h.id);
  for (const r of library.recognitions ?? []) ids.add(r.id);
  for (const i of Object.keys(library.counts ?? {})) ids.add(i);
  return [...ids].filter((i) => typeof i === "string" && i.includes(":"));
}
