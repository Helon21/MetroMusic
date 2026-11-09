import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Copy, Ellipsis, Languages, MicVocal, Pencil, RefreshCw, Search, Share2, Timer, Type, Image as ImageIcon } from "lucide-react";
import { getLyrics, translateLine, type LyricLine, type Track } from "../lib/catalog";
import { copyText, cx } from "../lib/util";
import { usePlayer } from "../store/player";
import { useSetting } from "../store/settings";
import { openDialog, toast, useUI, type MenuItem } from "../store/ui";
import { useActiveLine, useSmoothTime } from "../lib/clock";
import { useRealLyrics } from "../lib/lyricsStore";
import { Btn, Empty, IconBtn, Spinner } from "./ui";

interface LyrPrefs { offset: Record<string, number>; translated: Record<string, "loading" | "done">; setOffset: (id: string, v: number) => void; translate: (id: string) => void; clearTranslation: (id: string) => void }
export const useLyr = create<LyrPrefs>((set) => ({
  offset: {}, translated: {},
  setOffset: (id, v) => set((s) => ({ offset: { ...s.offset, [id]: v } })),
  translate: (id) => {
    set((s) => ({ translated: { ...s.translated, [id]: "loading" } }));
    setTimeout(() => { set((s) => ({ translated: { ...s.translated, [id]: "done" } })); toast("Letra traduzida"); }, 1400);
  },
  clearTranslation: (id) => set((s) => { const t = { ...s.translated }; delete t[id]; return { translated: t }; }),
}));

export function lyricsMenu(t: Track): MenuItem[] {
  const ly = getLyrics(t); const L = useLyr.getState(); const text = ly?.lines.map((l) => l.text).join("\n") ?? "";
  const tr = L.translated[t.id];
  return [
    { label: "Buscar outra letra…", icon: <Search />, onClick: () => openDialog("lyricsSearch", { id: t.id }) },
    { label: "Editar letra…", icon: <Pencil />, onClick: () => openDialog("lyricsEdit", { id: t.id }) },
    { label: "Buscar de novo", icon: <RefreshCw />, onClick: () => toast("Letra atualizada") },
    { divider: true },
    { label: tr === "done" ? "Remover tradução" : "Traduzir com IA", icon: <Languages />, disabled: !ly, onClick: () => (tr === "done" ? L.clearTranslation(t.id) : L.translate(t.id)) },
    { label: "Romanizar esta faixa", icon: <Type />, disabled: !ly, onClick: () => toast("Esta letra já usa o alfabeto latino") },
    { label: "Ajustar sincronia…", icon: <Timer />, disabled: !ly?.synced, onClick: () => openDialog("lyricsOffset", { id: t.id }) },
    { divider: true },
    { label: "Copiar toda a letra", icon: <Copy />, disabled: !ly, onClick: () => { copyText(text); toast("Letra copiada"); } },
    { label: "Compartilhar", icon: <Share2 />, disabled: !ly, sub: [
      { label: "Como texto", icon: <Type />, onClick: () => { copyText(text.split("\n").slice(0, 4).join("\n")); toast("Trecho copiado"); } },
      { label: "Como imagem…", icon: <ImageIcon />, onClick: () => openDialog("lyricsImage", { id: t.id }) },
    ] },
  ];
}

export function LyricsMenuButton({ track, size = 32 }: { track: Track; size?: number }) {
  const openMenuAt = useUI((s) => s.openMenuAt);
  return <IconBtn label="Opções da letra" size={size} onClick={(e) => openMenuAt(e.currentTarget, lyricsMenu(track))}><Ellipsis /></IconBtn>;
}

/** Palavras da linha ativa; só este componente re-renderiza a cada quadro. */
function ActiveWords({ l, anim, offset }: { l: LyricLine; anim: string; offset: number }) {
  const pos = useSmoothTime(offset);
  return (
    <>
      {l.words.map((w, k) => {
        const p = Math.min(1, Math.max(0, (pos - w.t) / Math.max(0.05, w.end - w.t)));
        const sung = pos >= w.end, on = pos >= w.t;
        const gradient = anim === "karaoke" || anim === "apple";
        return (
          <span key={k} className="inline-block transition-[transform,opacity,text-shadow] duration-200 ease-out"
            style={gradient
              ? { backgroundImage: `linear-gradient(to right, var(--t1) ${p * 100}%, color-mix(in oklch, var(--t1) 38%, transparent) ${p * 100 + (anim === "apple" ? 12 : 0)}%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", transform: anim === "apple" && on && !sung ? "translateY(-2px)" : undefined, marginRight: "0.26em" }
              : { opacity: on ? 1 : 0.4, transform: anim === "slide" ? `translateY(${on ? 0 : 5}px)` : undefined, textShadow: anim === "glow" && on && !sung ? "0 0 18px var(--t1)" : undefined, marginRight: "0.26em" }}>
            {w.w}
          </span>
        );
      })}
    </>
  );
}

/** Os três pontinhos do intervalo instrumental. */
function GapDots({ start, target, offset, size, align }: { start: number; target?: number; offset: number; size: number; align: string }) {
  const pos = useSmoothTime(offset);
  const p = target ? Math.min(1, Math.max(0, (pos - start) / (target - start))) : 0;
  return (
    <div data-line="gap" className={cx("flex gap-2.5 py-3", align === "center" && "justify-center", align === "right" && "justify-end")}>
      {[0, 1, 2].map((d) => <span key={d} className="rounded-full bg-t1 transition-all duration-500" style={{ width: size * 0.42, height: size * 0.42, opacity: p > (d + 0.3) / 3.4 ? 1 : 0.25, transform: `scale(${p > (d + 0.3) / 3.4 ? 1 : 0.8})`, animation: "dot 1.8s ease-in-out infinite", animationDelay: `${d * 0.25}s` }} />)}
    </div>
  );
}

/** Letra sincronizada. `scale` ajusta o tamanho relativo (painel lateral vs. tela cheia). */
export function LyricsView({ track, scale = 1, className }: { track: Track; scale?: number; className?: string }) {
  const real = useRealLyrics(track);
  const lyrics = useMemo(() => getLyrics(track), [track, real.version]);
  const offset = useLyr((s) => s.offset[track.id] ?? 0);
  const tr = useLyr((s) => s.translated[track.id]);
  const size = useSetting<number>("lyricsSize") * scale, spacing = useSetting<number>("lyricsSpacing");
  const align = useSetting<string>("lyricsPosition"), anim = useSetting<string>("lyricsAnimation");
  const glow = useSetting<boolean>("lyricsGlow"), blur = useSetting<boolean>("lyricsBlurInactive"), auto = useSetting<boolean>("lyricsAutoScroll");
  const clickSeek = useSetting<boolean>("lyricsClickSeek"), gaps = useSetting<boolean>("lyricsIntervalIndicator"), agents = useSetting<boolean>("lyricsAgentPositioning");
  const box = useRef<HTMLDivElement>(null);
  const [free, setFree] = useState(false); // usuário rolou manualmente
  const freeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const lines = lyrics?.lines ?? [];
  const { active, inGap } = useActiveLine(lines, !!lyrics?.synced, offset);
  const gapTarget = active >= 0 ? lines[active + 1]?.t : lines[0]?.t;
  const gapStart = active >= 0 ? lines[active].end : 0;

  useEffect(() => {
    if (!auto || free || !lyrics?.synced) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${inGap ? "gap" : active}"]`);
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight * 0.36, behavior: "smooth" });
  }, [active, inGap, auto, free, lyrics]);
  useEffect(() => { setFree(false); box.current?.scrollTo({ top: 0 }); }, [track.id]);

  if (!lyrics && real.loading) return <div className={cx("grid place-items-center text-t3", className)}><Spinner /></div>;
  if (!lyrics) return (
    <div className={cx("grid place-items-center", className)}>
      <Empty icon={<MicVocal />} title="Letra não encontrada" text="Nenhum provedor tem a letra desta faixa. Você pode buscar manualmente ou adicionar a sua.">
        <Btn icon={<Search />} onClick={() => openDialog("lyricsSearch", { id: track.id })}>Buscar letra</Btn>
        <Btn variant="ghost" icon={<Pencil />} onClick={() => openDialog("lyricsEdit", { id: track.id })}>Escrever</Btn>
      </Empty>
    </div>
  );

  const alignCls = (l: LyricLine) => (align === "center" ? "text-center origin-center" : align === "right" ? "text-right origin-right" : align === "sided" && l.bg ? "text-right origin-right" : "text-left origin-left");
  const gap = <GapDots start={gapStart} target={gapTarget} offset={offset} size={size} align={align} />;

  return (
    <div ref={box} className={cx("overflow-y-auto no-scrollbar mask-fade-y relative", className)}
      onWheel={() => { setFree(true); clearTimeout(freeTimer.current); freeTimer.current = setTimeout(() => setFree(false), 3500); }}>
      <div className="py-[32%] px-1" style={{ fontSize: size, lineHeight: 1.18 }}>
        {!lyrics.synced && <div className="text-t3 text-[0.8rem] font-medium uppercase tracking-wider mb-6" style={{ fontSize: 12 }}>Letra não sincronizada</div>}
        {tr === "loading" && <div className="flex items-center gap-2 text-t2 mb-6" style={{ fontSize: 14 }}><Spinner className="size-4" /> Traduzindo letra…</div>}
        {inGap && active < 0 && gaps && lyrics.synced && gap}
        {lines.map((l, i) => {
          const isActive = lyrics.synced && i === active && !inGap;
          const dist = lyrics.synced ? Math.abs(i - Math.max(active, 0)) : 0;
          const past = lyrics.synced && i < active;
          return (
            <div key={i}>
              <div data-line={i} onClick={() => clickSeek && lyrics.synced && usePlayer.getState().seek(l.t - offset + 0.01)}
                className={cx("font-bold tracking-tight transition-[opacity,transform,filter] duration-500 ease-out-soft will-change-transform", alignCls(l), clickSeek && lyrics.synced && "cursor-pointer hover:!opacity-90 hover:!blur-0",
                  l.bg && agents && "italic font-semibold")}
                style={{
                  marginBottom: `${(spacing - 0.6) * 0.8}em`, fontSize: l.bg && agents ? "0.72em" : undefined,
                  opacity: !lyrics.synced ? 0.9 : isActive ? 1 : past ? 0.32 : Math.max(0.22, 0.5 - dist * 0.07),
                  transform: isActive ? "scale(1)" : "scale(0.94)",
                  filter: blur && lyrics.synced && !isActive && !free ? `blur(${Math.min(3.5, dist * 0.7)}px)` : undefined,
                  textShadow: isActive && glow ? "0 0 28px color-mix(in oklch, var(--t1) 40%, transparent)" : undefined,
                }}>
                {isActive && anim !== "none" ? <ActiveWords l={l} anim={anim} offset={offset} /> : l.text}
                {tr === "done" && <div className="font-medium opacity-70 mt-1" style={{ fontSize: "0.5em", lineHeight: 1.3 }}>{translateLine(l.text)}</div>}
              </div>
              {inGap && i === active && gaps && lyrics.synced && gap}
            </div>
          );
        })}
        <div className="text-t3 font-medium mt-10" style={{ fontSize: 12.5 }}>Letra por {lyrics.provider}</div>
      </div>
      {free && lyrics.synced && (
        <div className="sticky bottom-6 flex justify-center pointer-events-none">
          <Btn size="sm" variant="primary" className="pointer-events-auto shadow-xl" icon={<RefreshCw />} onClick={() => setFree(false)}>Sincronizar</Btn>
        </div>
      )}
    </div>
  );
}

/** Linha única da letra atual (usada sob a capa e na barra do player). */
export function LyricLineNow({ track, className }: { track: Track; className?: string }) {
  const real = useRealLyrics(track);
  const lyrics = useMemo(() => getLyrics(track), [track, real.version]);
  const offset = useLyr((s) => s.offset[track.id] ?? 0);
  const { active } = useActiveLine(lyrics?.lines ?? [], !!lyrics?.synced, offset);
  const l = lyrics?.synced && active >= 0 ? lyrics.lines[active] : null;
  const pos = useSmoothTime(offset, !!l);
  const line = l && pos < l.end + 1.5 ? l.text : "";
  return <div key={line} className={cx("truncate animate-[fade_0.4s_ease]", className)} style={{ animation: "none" }}>{line || "♪"}</div>;
}
