// Tradução leve. O texto em pt-BR é a própria chave: `t("Fechar para a bandeja")`.
// Idioma sem entrada no dicionário cai no pt-BR, então nada some se faltar tradução.
//
// Para acrescentar um idioma:
//   1. crie src/i18n/locales/<código>.json  (ex.: es.json, com {"Aparência": "Apariencia", ...})
//   2. registre-o em LOCALES abaixo e em APP_LANGS (src/lib/settingsSchema.ts)
//   3. `node scripts/i18n-extract.mjs --write` cria no arquivo as chaves que faltam, vazias
import { getSetting, useSetting } from "../store/settings";
import en from "./locales/en.json";

export const LOCALES: Record<string, Record<string, string>> = { "pt-BR": {}, en };

/** Código do idioma efetivo: o escolhido, ou o do sistema quando for "system". */
export function resolveLang(pref: string): string {
  const want = pref === "system" || !pref ? (typeof navigator !== "undefined" ? navigator.language : "pt-BR") : pref;
  if (LOCALES[want]) return want;
  const base = want.split("-")[0];
  return Object.keys(LOCALES).find((k) => k === base || k.split("-")[0] === base) ?? "pt-BR";
}

/** Textos sem tradução vistos nesta sessão (só em desenvolvimento): `window.__i18nMiss`. */
const missed = new Set<string>();
if (import.meta.env?.DEV && typeof window !== "undefined") (window as any).__i18nMiss = missed;

export function translate(lang: string, text: string, vars?: Record<string, string | number>): string {
  if (lang !== "pt-BR" && !LOCALES[lang]?.[text] && import.meta.env?.DEV) missed.add(text);
  let s = LOCALES[lang]?.[text] || text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Hook: devolve `t` ligado ao idioma atual; a tela se redesenha quando o idioma muda. */
export function useT() {
  const lang = resolveLang(useSetting<string>("appLanguage"));
  return (text: string, vars?: Record<string, string | number>) => translate(lang, text, vars);
}

/** Tradução fora de componentes e em peças compartilhadas (botões, menus, avisos). Só traduz texto; o resto passa. */
export function tr(text?: string): string {
  return text ? translate(resolveLang(String(getSetting("appLanguage") ?? "system")), text) : "";
}
