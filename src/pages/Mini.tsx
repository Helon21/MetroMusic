import { useEffect, useRef, useState } from "react";
import { Heart, Maximize2, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { coverBg, Cover, Explicit, IconBtn } from "../components/ui";
import { closeThisWindow, emitEvent, invoke, onEvent } from "../lib/native";
import type { Snap } from "../lib/bridge";
import { fmtTime } from "../lib/util";

/** Conteúdo da janela do mini-player. Não tem estado próprio: reflete o que a janela principal envia. */
export default function Mini() {
  const [s, setS] = useState<Snap | null>(null);
  const [anchor, setAnchor] = useState({ pos: 0, at: Date.now() });
  const [, tick] = useState(0);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    let off: (() => void) | undefined; let dead = false;
    onEvent<Snap | null>("mm:state", (p) => { setS(p); setAnchor({ pos: p?.position ?? 0, at: Date.now() }); }).then((o) => (dead ? o() : (off = o)));
    emitEvent("mm:hello");
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => { dead = true; off?.(); clearInterval(t); };
  }, []);
  useEffect(() => { if (s) document.documentElement.style.setProperty("--h", String(s.hue)); }, [s?.hue]);

  const cmd = (type: string, value?: number) => emitEvent("mm:cmd", { type, value });
  const pos = s ? Math.min(s.duration, s.playing ? anchor.pos + ((Date.now() - anchor.at) / 1000) * s.speed : anchor.pos) : 0;
  const seek = (e: React.MouseEvent) => { if (!s || !bar.current) return; const r = bar.current.getBoundingClientRect(); cmd("seek", Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * s.duration); };

  if (!s) return (
    <div data-tauri-drag-region className="h-screen grid place-items-center bg-bg text-t3 text-[0.9rem] relative">
      Nada tocando
      <IconBtn label="Fechar" size={28} className="absolute top-2 right-2" onClick={closeThisWindow}><X /></IconBtn>
    </div>
  );
  return (
    <div data-tauri-drag-region className="relative h-screen w-screen overflow-hidden bg-bg text-t1 flex items-center gap-3.5 px-3.5 cursor-default">
      <div className="absolute inset-0 opacity-60 blur-2xl scale-150 pointer-events-none transition-[background] duration-700" style={{ background: coverBg(s.hue, s.seed) }} />
      <div className="absolute inset-0 bg-black/55 pointer-events-none" />
      <Cover hue={s.hue} seed={s.seed} className="relative size-[92px] rounded-xl shadow-xl shadow-black/40" />
      <div data-tauri-drag-region className="relative flex-1 min-w-0 h-[92px] flex flex-col justify-between">
        <div data-tauri-drag-region className="flex items-start gap-1">
          <div data-tauri-drag-region className="flex-1 min-w-0 pt-0.5">
            <div data-tauri-drag-region className="truncate font-semibold leading-tight">{s.title}</div>
            <div data-tauri-drag-region className="truncate text-t2 text-[0.82rem] flex items-center gap-1.5">{s.explicit && <Explicit />}{s.artist}</div>
          </div>
          <IconBtn label="Abrir o MetroMusic" size={26} className="-mt-0.5" onClick={() => invoke("show_main_window")}><Maximize2 /></IconBtn>
          <IconBtn label="Fechar" size={26} className="-mt-0.5 -mr-1" onClick={closeThisWindow}><X /></IconBtn>
        </div>
        <div className="flex items-center justify-between -ml-1.5">
          <IconBtn label={s.liked ? "Remover curtida" : "Curtir"} size={30} active={s.liked} onClick={() => cmd("like")}><Heart fill={s.liked ? "currentColor" : "none"} /></IconBtn>
          <div className="flex items-center gap-1">
            <IconBtn label="Anterior" size={32} className="!text-t1" onClick={() => cmd("prev")}><SkipBack fill="currentColor" /></IconBtn>
            <button aria-label={s.playing ? "Pausar" : "Tocar"} onClick={() => cmd("toggle")} className="size-9 rounded-full bg-t1 text-bg grid place-items-center hover:scale-105 active:scale-95 transition-transform">
              {s.playing ? <Pause className="size-4" fill="currentColor" strokeWidth={0} /> : <Play className="size-4 ml-0.5" fill="currentColor" strokeWidth={0} />}
            </button>
            <IconBtn label="Próxima" size={32} className="!text-t1" onClick={() => cmd("next")}><SkipForward fill="currentColor" /></IconBtn>
          </div>
          <span className="w-[30px]" />
        </div>
        <div className="flex items-center gap-2 text-[0.7rem] tnum text-t2">
          <span className="w-8 text-right">{fmtTime(pos)}</span>
          <div ref={bar} role="slider" aria-label="Posição" aria-valuenow={Math.round(pos)} aria-valuemax={s.duration} onClick={seek} className="group flex-1 h-4 flex items-center cursor-pointer">
            <div className="relative w-full h-1 group-hover:h-1.5 rounded-full bg-t1/20 transition-[height]"><div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${s.duration ? (pos / s.duration) * 100 : 0}%` }} /></div>
          </div>
          <span className="w-8">{fmtTime(s.duration)}</span>
        </div>
      </div>
    </div>
  );
}
