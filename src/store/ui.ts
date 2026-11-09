import { create } from "zustand";
import type { ReactNode } from "react";
import type { SourceId } from "../lib/catalog";

export interface MenuItem {
  label?: string; icon?: ReactNode; hint?: string; onClick?: () => void;
  danger?: boolean; divider?: boolean; checked?: boolean; disabled?: boolean; sub?: MenuItem[]; header?: boolean;
}
export interface Toast { id: number; text: string; action?: { label: string; fn: () => void } }
export type Panel = "queue" | "lyrics" | "details" | null;

interface UI {
  stack: string[]; idx: number;
  nav: (to: string) => void; back: () => void; fwd: () => void; replace: (to: string) => void;
  panel: Panel; setPanel: (p: Panel) => void; togglePanel: (p: Exclude<Panel, null>) => void;
  nowPlaying: boolean; setNowPlaying: (v: boolean) => void;
  lyricsOnly: boolean; setLyricsOnly: (v: boolean) => void;
  sidebarCollapsed: boolean; toggleSidebar: () => void;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  openMenu: (e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) => void;
  openMenuAt: (el: HTMLElement, items: MenuItem[]) => void;
  closeMenu: () => void;
  dialog: { type: string; props: any } | null;
  openDialog: (type: string, props?: any) => void; closeDialog: () => void;
  toasts: Toast[]; toast: (text: string, action?: Toast["action"]) => void; dismissToast: (id: number) => void;
  sel: string[]; setSel: (ids: string[]) => void;
  palette: boolean; setPalette: (v: boolean) => void;
  homeSource: SourceId; setHomeSource: (s: SourceId) => void;
  online: boolean; setOnline: (v: boolean) => void;
  crash: string | null;
}

let toastId = 1;
/** Posição de rolagem por entrada do histórico de navegação. */
export const scrollMemo = new Map<number, number>();

export const useUI = create<UI>((set, get) => ({
  stack: ["home"], idx: 0,
  nav: (to) => { const { stack, idx } = get(); if (stack[idx] === to) return; set({ stack: [...stack.slice(0, idx + 1), to], idx: idx + 1, sel: [], nowPlaying: false }); },
  replace: (to) => { const { stack, idx } = get(); const s = [...stack]; s[idx] = to; set({ stack: s }); },
  back: () => set((s) => (s.idx > 0 ? { idx: s.idx - 1, sel: [] } : s)),
  fwd: () => set((s) => (s.idx < s.stack.length - 1 ? { idx: s.idx + 1, sel: [] } : s)),
  panel: null, setPanel: (panel) => set({ panel }),
  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  nowPlaying: false, setNowPlaying: (nowPlaying) => set({ nowPlaying, lyricsOnly: false }),
  lyricsOnly: false, setLyricsOnly: (lyricsOnly) => set({ lyricsOnly }),
  sidebarCollapsed: false, toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  menu: null,
  openMenu: (e, items) => { e.preventDefault?.(); e.stopPropagation?.(); set({ menu: { x: e.clientX, y: e.clientY, items } }); },
  openMenuAt: (el, items) => { const r = el.getBoundingClientRect(); set({ menu: { x: r.left, y: r.bottom + 6, items } }); },
  closeMenu: () => set({ menu: null }),
  dialog: null, openDialog: (type, props = {}) => set({ dialog: { type, props }, menu: null }), closeDialog: () => set({ dialog: null }),
  toasts: [],
  toast: (text, action) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 6000 : 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  sel: [], setSel: (sel) => set({ sel }),
  palette: false, setPalette: (palette) => set({ palette }),
  homeSource: "youtube", setHomeSource: (homeSource) => set({ homeSource }),
  online: true, setOnline: (online) => set({ online }),
  crash: null,
}));

export const nav = (to: string) => useUI.getState().nav(to);
export const toast = (text: string, action?: Toast["action"]) => useUI.getState().toast(text, action);
export const openDialog = (type: string, props?: any) => useUI.getState().openDialog(type, props);
export const useRoute = () => useUI((s) => s.stack[s.idx]);
