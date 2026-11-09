import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULTS } from "../lib/settingsSchema";

interface SettingsState { v: Record<string, any>; set: (k: string, val: any) => void; reset: (k: string) => void }

// Hoje persiste em localStorage; o backend troca por um arquivo de preferências.
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      v: {},
      set: (k, val) => set((s) => ({ v: { ...s.v, [k]: val } })),
      reset: (k) => set((s) => { const v = { ...s.v }; delete v[k]; return { v }; }),
    }),
    { name: "metromusic-settings-v1" },
  ),
);

export function useSetting<T = any>(k: string): T { return useSettings((s) => (k in s.v ? s.v[k] : DEFAULTS[k])); }
export function getSetting<T = any>(k: string): T { const v = useSettings.getState().v; return k in v ? v[k] : DEFAULTS[k]; }
export const setSetting = (k: string, val: any) => useSettings.getState().set(k, val);
