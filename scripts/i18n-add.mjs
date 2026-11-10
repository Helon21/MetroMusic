// Acrescenta traduções ao en.json a partir de pares "pt ⇒ en" (um por linha) lidos da entrada padrão.
import { readFileSync, writeFileSync } from "node:fs";
const f = new URL("../src/i18n/locales/" + (process.argv[2] ?? "en") + ".json", import.meta.url);
const d = JSON.parse(readFileSync(f, "utf8"));
for (const l of readFileSync(0, "utf8").split("\n")) { const i = l.indexOf(" ⇒ "); if (i > 0) d[l.slice(0, i)] = l.slice(i + 3); }
writeFileSync(f, JSON.stringify(d, null, 2) + "\n");
