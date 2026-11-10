// Notas da versão (Markdown simples do corpo da release do GitHub) → blocos para mostrar no aviso de atualização.

export type NoteBlock = { kind: "h"; text: string } | { kind: "li"; text: string } | { kind: "p"; text: string };

/** Tira marcas de Markdown inline (negrito, itálico, código, links) e deixa só o texto. */
export function plain(s: string): string {
  return s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`~]{1,3}([^*_`~]+)[*_`~]{1,3}/g, "$1").replace(/<[^>]+>/g, "").trim();
}

/** Títulos (`#`), itens (`-`, `*`, `+` ou `1.`) e parágrafos. Linhas vazias, divisórias e comentários HTML somem. */
export function parseNotes(md: string | null | undefined, max = 60): NoteBlock[] {
  const out: NoteBlock[] = [];
  let inComment = false;
  for (const raw of (md ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (inComment) { if (line.includes("-->")) inComment = false; continue; }
    if (line.startsWith("<!--")) { if (!line.includes("-->")) inComment = true; continue; }
    if (!line || /^([-*_])\1{2,}$/.test(line)) continue;
    let m: RegExpExecArray | null;
    if ((m = /^#{1,6}\s+(.*)$/.exec(line))) { const t = plain(m[1]); if (t) out.push({ kind: "h", text: t }); }
    else if ((m = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(line))) { const t = plain(m[1]); if (t) out.push({ kind: "li", text: t }); }
    else { const t = plain(line); if (t) out.push({ kind: "p", text: t }); }
    if (out.length >= max) break;
  }
  return out;
}

/** Bytes → "12,3 MB". */
export function fmtBytes(n: number): string {
  if (!(n > 0)) return "0 MB";
  const mb = n / 1048576;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1).replace(".", ",")} MB`;
}
