import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULTS } from "../lib/settingsSchema";
import { invoke, isTauri } from "../lib/native";

interface SettingsState { v: Record<string, any>; set: (k: string, val: any) => void; reset: (k: string) => void }

/** Valores sensíveis: no app nativo ficam em `secrets.json` (0600), nunca no localStorage. */
export const SECRET_KEYS = ["aiKey", "proxyPass"];
const isSecret = (k: string) => SECRET_KEYS.includes(k);

// O arquivo (`settings.json`) é a fonte da verdade no app nativo; o localStorage é só a cópia que
// permite abrir a janela já com os valores (e é a única persistência no navegador, em desenvolvimento).
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      v: {},
      set: (k, val) => set((s) => ({ v: { ...s.v, [k]: val } })),
      reset: (k) => set((s) => { const v = { ...s.v }; delete v[k]; return { v }; }),
    }),
    {
      name: "metromusic-settings-v1",
      partialize: (s) => ({ v: isTauri ? Object.fromEntries(Object.entries(s.v).filter(([k]) => !isSecret(k))) : s.v }),
    },
  ),
);

export function useSetting<T = any>(k: string): T { return useSettings((s) => (k in s.v ? s.v[k] : DEFAULTS[k])); }
export function getSetting<T = any>(k: string): T { const v = useSettings.getState().v; return k in v ? v[k] : DEFAULTS[k]; }
export const setSetting = (k: string, val: any) => useSettings.getState().set(k, val);

interface Stored { exists: boolean; values: Record<string, any>; secrets: Record<string, any> }

/** Separa o que vai para cada arquivo. Exportada para teste. */
export function splitForDisk(v: Record<string, any>) {
  const values: Record<string, any> = {}, secrets: Record<string, any> = {};
  for (const [k, x] of Object.entries(v)) (isSecret(k) ? secrets : values)[k] = x;
  return { values, secrets };
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const flush = () => { const { values, secrets } = splitForDisk(useSettings.getState().v); return invoke("settings_save", { values, secrets }); };

/**
 * Carrega as configurações do arquivo antes da interface subir e passa a gravar cada mudança.
 * Sem arquivo ainda (primeira execução com esta versão), migra o que estava no localStorage.
 */
export async function initSettingsFile() {
  if (!isTauri) return;
  try {
    const st = await invoke<Stored>("settings_load");
    if (st?.exists) useSettings.setState({ v: { ...st.values, ...st.secrets } });
    else {
      // migração: os segredos que ainda estejam no localStorage antigo passam para o arquivo protegido
      try { const old = JSON.parse(localStorage.getItem("metromusic-settings-v1") ?? "{}")?.state?.v ?? {}; useSettings.setState({ v: { ...old, ...useSettings.getState().v } }); } catch { /* sem cópia antiga */ }
      await flush();
    }
  } catch (e) { console.warn("configurações em arquivo indisponíveis:", e); return; }
  useSettings.subscribe((s, prev) => {
    if (s.v === prev.v) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { flush()?.catch((e) => console.warn("não consegui gravar as configurações:", e)); }, 400);
  });
  window.addEventListener("beforeunload", () => { flush(); });
}
