// Lista os textos das Configurações (pt-BR é o idioma-fonte) e mostra o que falta em cada idioma.
// Uso: node scripts/i18n-extract.mjs [--write]   (--write cria as chaves faltantes com valor vazio)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PAGES, PALETTES } from "../src/lib/settingsSchema.ts";

export function collect() {
  const out = new Set();
  const add = (s) => { if (typeof s === "string" && s.trim()) out.add(s); };
  for (const p of PAGES) {
    add(p.title); add(p.desc); add(p.group);
    if (p.unavailable) add(p.unavailable);
    for (const s of p.sections) {
      add(s.title);
      for (const it of s.items) {
        add(it.label); add(it.desc); add(it.text); add(it.button); add(it.placeholder);
        if (it.options) for (const [, l] of it.options) add(l);
        if (it.names) for (const l of Object.values(it.names)) add(l);
      }
    }
  }
  for (const [, name] of PALETTES) add(name);
  // textos escritos direto no código: t("…") e t('…')
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|ts)$/.test(f)) {
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) add(JSON.parse(`"${m[1]}"`));
  } } };
  walk(new URL("../src", import.meta.url).pathname);
  return [...out].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

if (process.argv[1]?.endsWith("i18n-extract.mjs")) {
  const keys = collect();
  const dir = new URL("../src/i18n/locales/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "pt-BR.json");
  console.log(`${keys.length} textos nas Configurações`);
  for (const f of files) {
    const path = new URL(f, dir);
    const dict = JSON.parse(readFileSync(path, "utf8"));
    const miss = keys.filter((k) => !dict[k]);
    console.log(`${f}: ${miss.length} sem tradução`);
    if (process.argv.includes("--write")) { for (const k of miss) dict[k] = ""; writeFileSync(path, JSON.stringify(dict, null, 2) + "\n"); }
    else miss.slice(0, 20).forEach((k) => console.log("  -", k));
  }
}
