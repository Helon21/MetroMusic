export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60), m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
export function fmtLong(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
export function fmtCount(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(".", ",") + " bi";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + " mi";
  if (n >= 1e3) return Math.round(n / 1e3) + " mil";
  return String(n);
}
export const fmtNum = (n: number) => n.toLocaleString("pt-BR");
export function dayLabel(ts: number) {
  const d = new Date(ts), now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 864e5);
  if (diff <= 0) return "Hoje";
  if (diff === 1) return "Ontem";
  if (diff < 7) return "Esta semana";
  if (diff < 14) return "Semana passada";
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function copyText(text: string) { navigator.clipboard?.writeText(text).catch(() => {}); }
