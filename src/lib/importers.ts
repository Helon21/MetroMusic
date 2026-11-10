// Leitura de playlists M3U e CSV (funções puras, testadas em scripts/tests/importers.test.mjs).

export interface ImportItem { title: string; artist: string; path?: string; url?: string; durationSec?: number }

const AUDIO_EXT = /\.(mp3|flac|m4a|mp4|aac|ogg|oga|opus|wav|aiff?|wma)$/i;

/** `#EXTINF:123,Artista - Título` seguido do caminho ou do endereço. Aceita M3U simples (só caminhos) e M3U8. */
export function parseM3u(text: string): ImportItem[] {
  const out: ImportItem[] = [];
  let pending: { title: string; artist: string; durationSec?: number } | null = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$/i.exec(line);
      if (m) {
        const label = m[2].trim();
        const i = label.indexOf(" - ");
        const dur = Number(m[1]);
        pending = i > 0 ? { artist: label.slice(0, i).trim(), title: label.slice(i + 3).trim(), durationSec: dur > 0 ? dur : undefined } : { artist: "", title: label, durationSec: dur > 0 ? dur : undefined };
      }
      continue;
    }
    const isUrl = /^https?:\/\//i.test(line);
    const path = line.replace(/^file:\/\//i, "");
    const item: ImportItem = { ...(pending ?? { title: "", artist: "" }), ...(isUrl ? { url: line } : { path }) };
    if (!item.title) item.title = (path.split(/[\\/]/).pop() ?? "").replace(AUDIO_EXT, "").trim();
    pending = null;
    if (item.title || item.url || item.path) out.push(item);
  }
  return out;
}

/** CSV com aspas, aspas duplicadas, quebra de linha dentro de campo e separador `,`, `;` ou tabulação (detectado). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => first.split(c).length - 1;
  const sep = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
const TITLE_NAMES = ["track name", "track", "title", "song", "song name", "name", "musica", "titulo", "nome da musica"];
const ARTIST_NAMES = ["artist name s", "artist names", "artist name", "artists", "artist", "artista", "artistas", "nome do artista"];
const URL_NAMES = ["url", "link", "track url", "track uri", "track link", "spotify url", "spotify uri", "uri"];

/** Descobre quais colunas são título, artista e link pelo cabeçalho; `-1` = não achou. */
export function guessColumns(header: string[]): { title: number; artist: number; url: number } {
  const h = header.map(norm);
  const find = (names: string[]) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  return { title: find(TITLE_NAMES), artist: find(ARTIST_NAMES), url: find(URL_NAMES) };
}

/** Linhas do CSV → itens a procurar. `artist` pode ter vários nomes (`A, B` ou `A;B`): fica o texto todo. */
export function rowsToItems(rows: string[][], hasHeader: boolean, cols: { title: number; artist: number; url?: number }): ImportItem[] {
  const out: ImportItem[] = [];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const title = (r[cols.title] ?? "").trim();
    if (!title) continue;
    const url = cols.url !== undefined && cols.url >= 0 ? (r[cols.url] ?? "").trim() : "";
    out.push({ title, artist: cols.artist >= 0 ? (r[cols.artist] ?? "").trim().replace(/\s*;\s*/g, ", ") : "", ...(/^https?:\/\//i.test(url) ? { url } : {}) });
  }
  return out;
}
