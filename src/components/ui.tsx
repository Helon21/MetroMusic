import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import { Check, ChevronDown, Clock, Download, Folder, Heart, LoaderCircle, TrendingUp, Upload, X, HardDrive } from "lucide-react";
import { cx } from "../lib/util";
import { useUI, type MenuItem } from "../store/ui";

// ───────── Arte generativa (substitui capas reais enquanto não há backend)
export function coverBg(hue: number, seed: number): string {
  const h = (d: number) => (hue + d + 360) % 360;
  const a = seed % 97, b = (seed >> 3) % 89, v = seed % 5;
  const c1 = `oklch(0.74 0.15 ${h(0)})`, c2 = `oklch(0.5 0.16 ${h(45)})`, c3 = `oklch(0.27 0.09 ${h(-35)})`, c4 = `oklch(0.88 0.11 ${h(80)})`;
  switch (v) {
    case 0: return `radial-gradient(circle at ${10 + a}% ${15 + (b % 60)}%, ${c4} 0, transparent 34%), radial-gradient(circle at ${90 - (a % 50)}% ${85 - (b % 40)}%, ${c2} 0, transparent 52%), linear-gradient(${a * 4}deg, ${c1}, ${c3})`;
    case 1: return `conic-gradient(from ${a * 4}deg at ${25 + (b % 50)}% ${30 + (a % 45)}%, ${c1}, ${c3}, ${c2}, ${c4}, ${c1})`;
    case 2: return `repeating-radial-gradient(circle at ${20 + (a % 60)}% ${110 - (b % 40)}%, ${c3} 0 7%, ${c2} 7% 14%, ${c1} 14% 21%)`;
    case 3: return `radial-gradient(circle at 50% ${58 + (a % 12)}%, ${c4} 0 ${20 + (b % 10)}%, transparent ${20.5 + (b % 10)}%), linear-gradient(to bottom, ${c3} 0%, ${c2} 55%, ${c1} 68%, ${c3} 68.2%, oklch(0.16 0.05 ${h(-35)}) 100%)`;
    default: return `linear-gradient(${115 + a}deg, transparent 0 38%, ${c4} 38% 44%, transparent 44% 52%, ${c1} 52% 70%, transparent 70%), linear-gradient(${a * 3}deg, ${c3}, ${c2})`;
  }
}
const AUTO_ICONS: Record<string, ReactNode> = { heart: <Heart fill="currentColor" />, download: <Download />, trending: <TrendingUp />, cache: <HardDrive />, folder: <Folder />, upload: <Upload />, clock: <Clock /> };

export function Cover({ hue, seed, round, artist, icon, src, className, style, children }: { hue: number; seed: number; round?: boolean; artist?: boolean; icon?: string; src?: string; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className={cx("relative shrink-0 overflow-hidden bg-s2 aspect-square", round || artist ? "rounded-full" : "rounded-[10px]", className)}
      style={{ background: src ? undefined : icon ? `linear-gradient(140deg, oklch(0.62 0.17 ${hue}), oklch(0.32 0.12 ${(hue + 40) % 360}))` : coverBg(hue, seed), ...style }}>
      {src && <img src={src} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />}
      {artist && !src && (
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
          <circle cx="50" cy="40" r="17" fill={`oklch(0.2 0.06 ${hue} / 0.55)`} /><path d="M14 104c0-24 16-38 36-38s36 14 36 38z" fill={`oklch(0.2 0.06 ${hue} / 0.55)`} />
        </svg>
      )}
      {icon && <div className="absolute inset-0 grid place-items-center text-white/95 [&>svg]:size-[38%] drop-shadow">{AUTO_ICONS[icon]}</div>}
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/15 pointer-events-none" />
      {children}
    </div>
  );
}

// ───────── Controles básicos
export function IconBtn({ children, label, active, onClick, className, size = 36, disabled, onContextMenu }: { children: ReactNode; label: string; active?: boolean; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; className?: string; size?: number; disabled?: boolean; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} onContextMenu={onContextMenu}
      style={{ width: size, height: size }}
      className={cx("grid place-items-center rounded-full shrink-0 transition-[background,color,transform] duration-150 active:scale-90 [&>svg]:size-[1.15rem] disabled:opacity-35 disabled:pointer-events-none",
        active ? "text-accent bg-accent-soft" : "text-t2 hover:text-t1 hover:bg-s2", className)}>
      {children}
    </button>
  );
}

export function Btn({ children, icon, variant = "soft", size = "md", onClick, className, disabled, title }: { children?: ReactNode; icon?: ReactNode; variant?: "primary" | "soft" | "ghost" | "outline" | "danger"; size?: "sm" | "md" | "lg"; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; className?: string; disabled?: boolean; title?: string }) {
  const v = { primary: "bg-accent text-accent-fg hover:brightness-110", soft: "bg-s2 hover:bg-s3 text-t1", ghost: "hover:bg-s2 text-t2 hover:text-t1", outline: "border border-line hover:bg-s2 text-t1", danger: "bg-danger/15 text-danger hover:bg-danger/25" }[variant];
  const s = { sm: "h-8 px-3 text-[0.82rem] gap-1.5", md: "h-9.5 px-4 gap-2", lg: "h-12 px-6 gap-2.5 text-[1rem]" }[size];
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={cx("inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap shrink-0 transition-[background,filter,transform] duration-150 active:scale-[0.96] [&>svg]:size-[1.05rem] disabled:opacity-40 disabled:pointer-events-none", v, s, className)}>
      {icon}{children}
    </button>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={cx("relative h-6 w-10.5 rounded-full shrink-0 transition-colors duration-200", on ? "bg-accent" : "bg-s3")}>
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 34 }} className={cx("absolute top-0.75 size-4.5 rounded-full shadow", on ? "right-0.75 bg-accent-fg" : "left-0.75 bg-t2")} />
    </button>
  );
}

export function Chip({ children, active, onClick, icon, onClose }: { children: ReactNode; active?: boolean; onClick?: () => void; icon?: ReactNode; onClose?: () => void }) {
  return (
    <button onClick={onClick} className={cx("h-8 px-3.5 rounded-full text-[0.84rem] font-medium whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 transition-colors duration-150 [&>svg]:size-3.5",
      active ? "bg-t1 text-bg" : "bg-s2 text-t2 hover:bg-s3 hover:text-t1")}>
      {icon}{children}{onClose && <X onClick={(e) => { e.stopPropagation(); onClose(); }} />}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, id }: { value: T; onChange: (v: T) => void; options: [T, ReactNode][]; id: string }) {
  return (
    <div className="inline-flex p-1 rounded-full bg-s2 gap-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={cx("relative h-7.5 px-3.5 rounded-full text-[0.84rem] font-medium transition-colors inline-flex items-center gap-1.5 [&>svg]:size-4", value === v ? "text-accent-fg" : "text-t2 hover:text-t1")}>
          {value === v && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          <span className="relative inline-flex items-center gap-1.5">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Seletor que reaproveita o menu de contexto como lista suspensa. */
export function Select({ value, onChange, options, className }: { value: string; onChange: (v: string) => void; options: [string, string][]; className?: string }) {
  const openMenuAt = useUI((s) => s.openMenuAt);
  const cur = options.find((o) => o[0] === value)?.[1] ?? value;
  return (
    <button onClick={(e) => openMenuAt(e.currentTarget, options.map(([v, label]): MenuItem => ({ label, checked: v === value, onClick: () => onChange(v) })))}
      className={cx("h-9 pl-3.5 pr-2.5 rounded-lg bg-s2 hover:bg-s3 inline-flex items-center gap-2 text-[0.88rem] max-w-72 transition-colors", className)}>
      <span className="truncate">{cur}</span><ChevronDown className="size-4 text-t3 shrink-0" />
    </button>
  );
}

export function Range({ value, min = 0, max = 1, step = 0.01, onChange, className, fill, vertical, label }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; className?: string; fill?: string; vertical?: boolean; label?: string }) {
  const p = ((value - min) / (max - min)) * 100;
  return <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
    className={cx(className, vertical && "-rotate-90")} style={{ ["--p" as any]: `${p}%`, ...(fill ? { ["--fill" as any]: fill } : {}) }} />;
}

export function TextField({ value, onChange, placeholder, secret, multiline, className, autoFocus, onEnter, icon }: { value: string; onChange: (v: string) => void; placeholder?: string; secret?: boolean; multiline?: boolean; className?: string; autoFocus?: boolean; onEnter?: () => void; icon?: ReactNode }) {
  const base = "w-full rounded-lg bg-s2 border border-transparent focus:border-accent/60 focus:bg-s1 px-3.5 text-[0.9rem] placeholder:text-t3 transition-colors";
  if (multiline) return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={cx(base, "py-2.5 resize-y min-h-20 font-mono text-[0.82rem]", className)} />;
  return (
    <div className={cx("relative", className)}>
      {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-t3 [&>svg]:size-4">{icon}</span>}
      <input autoFocus={autoFocus} type={secret ? "password" : "text"} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onEnter?.()} placeholder={placeholder} className={cx(base, "h-9.5", !!icon && "pl-9")} />
    </div>
  );
}

export function Checkbox({ on, onChange }: { on: boolean; onChange?: (v: boolean) => void }) {
  return (
    <button role="checkbox" aria-checked={on} onClick={(e) => { e.stopPropagation(); onChange?.(!on); }} className={cx("size-4.5 rounded-[5px] grid place-items-center border transition-colors shrink-0", on ? "bg-accent border-accent text-accent-fg" : "border-t3 hover:border-t1")}>
      {on && <Check className="size-3.5" strokeWidth={3} />}
    </button>
  );
}

/** Indicador "tocando" de três barras. */
export function Eq({ paused, className }: { paused?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-end gap-[2px] h-3.5", paused && "eq-paused", className)} aria-hidden>
      {[0, 0.3, 0.15].map((d, i) => <span key={i} className="eq-bar w-[3px] h-full rounded-sm bg-accent" style={{ animationDelay: `-${d}s` }} />)}
    </span>
  );
}
export const Spinner = ({ className }: { className?: string }) => <LoaderCircle className={cx("animate-spin", className)} />;
export const Badge = ({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "accent" | "ok" | "warn" | "danger"; className?: string }) => (
  <span className={cx("inline-flex items-center gap-1 h-5 px-1.5 rounded-[5px] text-[0.68rem] font-semibold tracking-wide uppercase whitespace-nowrap [&>svg]:size-3",
    { default: "bg-s3 text-t2", accent: "bg-accent-soft text-accent", ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", danger: "bg-danger/15 text-danger" }[tone], className)}>{children}</span>
);
export const Explicit = () => <span title="Explícito" className="inline-grid place-items-center size-3.5 rounded-[3px] bg-t3/60 text-bg text-[0.58rem] font-bold shrink-0 leading-none">E</span>;
export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="inline-flex items-center h-5.5 min-w-5.5 justify-center px-1.5 rounded-md bg-s3 text-t2 text-[0.72rem] font-medium font-sans border-b-2 border-black/25">{children}</kbd>;

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
      <div className="size-16 rounded-full bg-s2 grid place-items-center text-t3 [&>svg]:size-7">{icon}</div>
      <div className="text-[1.05rem] font-semibold">{title}</div>
      {text && <div className="text-t3 max-w-sm">{text}</div>}
      {children && <div className="mt-2 flex gap-2">{children}</div>}
    </div>
  );
}

/** Casca de diálogo modal: fecha com Esc e clique fora. */
export function Modal({ title, children, footer, onClose, width = 460, subtitle }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <motion.div className="fixed inset-0 z-[70] grid place-items-center p-6 bg-black/55 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div ref={ref} tabIndex={-1} role="dialog" aria-label={title} style={{ width, boxShadow: "var(--shadow)" }} className="max-w-full max-h-[86vh] flex flex-col rounded-2xl bg-s1 outline-none"
        initial={{ scale: 0.95, y: 10, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }} transition={{ type: "spring", stiffness: 520, damping: 36 }}>
        <div className="flex items-start gap-3 px-6 pt-5 pb-3">
          <div className="flex-1 min-w-0"><div className="text-[1.15rem] font-semibold">{title}</div>{subtitle && <div className="text-t3 text-[0.86rem] mt-0.5">{subtitle}</div>}</div>
          <IconBtn label="Fechar" size={32} onClick={onClose} className="-mr-2 -mt-1"><X /></IconBtn>
        </div>
        <div className="px-6 pb-5 overflow-y-auto min-h-0">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-6 py-4 border-t border-line">{footer}</div>}
      </motion.div>
    </motion.div>
  );
}

export const SectionTitle = ({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) => (
  <div className="flex items-end gap-3 mb-3.5">
    <div className="flex-1 min-w-0">{sub && <div className="text-t3 text-[0.8rem] font-medium mb-0.5">{sub}</div>}<h2 className="text-[1.35rem] font-semibold tracking-tight truncate">{children}</h2></div>
    {action}
  </div>
);
