// Liga a romanização (lib/romanize.ts) às configurações: quais idiomas estão ligados e como detectar o cirílico.
import { useEffect, useMemo, useState } from "react";
import { cyrillicLang, romanize, ROMAN_ORDER, ROMAN_SUPPORTED, type Pinyin, type Roman } from "./romanize";
import { useSettings } from "../store/settings";
import { DEFAULTS } from "./settingsSchema";

const on = (v: Record<string, any>, k: string) => (k in v ? v[k] : DEFAULTS[k]);

// O dicionário de pinyin (~1 MB) só é baixado quando o chinês está ligado.
let pinyinFn: Pinyin | null = null, pinyinLoading: Promise<void> | null = null;
function loadPinyin() {
  pinyinLoading ??= import("pinyin-pro").then((m) => { pinyinFn = (t) => m.pinyin(t, { toneType: "symbol", nonZh: "consecutive" }); }).catch(() => { pinyinLoading = null; });
  return pinyinLoading;
}

/** Devolve `texto → romanizado | null` (null = nada a romanizar). Refaz quando as configurações mudam. */
export function useRomanizer(texts: string[]): (t: string) => string | null {
  const v = useSettings((s) => s.v);
  const key = texts.length;
  const wantZh = !!on(v, `romanize_${ROMAN_ORDER.indexOf("zh")}`);
  const [, setReady] = useState(!!pinyinFn);
  useEffect(() => { if (wantZh && !pinyinFn) loadPinyin().then(() => setReady(true)); }, [wantZh]);
  return useMemo(() => {
    const enabled = new Set<Roman>(ROMAN_ORDER.filter((l, i) => ROMAN_SUPPORTED.has(l) && on(v, `romanize_${i}`)));
    if (!enabled.size) return () => null;
    // por padrão o idioma do cirílico vem da música inteira; "linha a linha" decide em cada linha
    const song = on(v, "romanizeLineByLine") ? undefined : cyrillicLang(texts.join("\n"));
    return (t: string) => romanize(t, enabled, song, pinyinFn ?? undefined);
  }, [v, key, pinyinFn]); // eslint-disable-line react-hooks/exhaustive-deps
}
