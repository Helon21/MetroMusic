import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Copy, Ellipsis, Languages, MicVocal, Pencil, RefreshCw, Search, Share2, Timer, Type, Image as ImageIcon } from "lucide-react";
import { useRomanizer } from "../lib/romanizeSettings";
import { getLyrics, getTrack, type LyricLine, type Track } from "../lib/catalog";
import { invoke } from "../lib/native";
import { getSetting, useSetting } from "../store/settings";
import { copyText, cx } from "../lib/util";
import { usePlayer } from "../store/player";
import { nav, openDialog, toast, useUI, type MenuItem } from "../store/ui";
import { useActiveLine, useSmoothTime } from "../lib/clock";
import { useRealLyrics } from "../lib/lyricsStore";
import { Btn, Empty, IconBtn, Spinner } from "./ui";

interface LyrPrefs { offset: Record<string, number>; translated: Record<string, "loading" | "done">; translations: Record<string, string[]>; setOffset: (id: string, v: number) => void; translate: (id: string) => void; clearTranslation: (id: string) => void }
export const useLyr = create<LyrPrefs>((set) => ({
  offset: {}, translated: {}, translations: {},
  setOffset: (id, v) => set((s) => ({ offset: { ...s.offset, [id]: v } })),
  translate: (id) => {
    const track = getTrack(id); const lines = (track && getLyrics(track)?.lines.map((l) => l.text)) ?? [];
    if (!lines.length) return void toast("Esta faixa não tem letra para traduzir");
    if (!getSetting("aiKey")) { toast("Informe a chave da API em Configurações › Tradução por IA"); nav("settings/ai"); return; }
    const g = (k: string) => getSetting(k);
    const config = { provider: g("aiProvider"), baseUrl: g("aiBaseUrl"), key: g("aiKey"), model: g("aiModel"), mode: g("aiMode"), target: g("aiTarget"), formality: g("aiFormality"), prompt: g("aiPrompt") };
    set((s) => ({ translated: { ...s.translated, [id]: "loading" } }));
    const fail = (msg: string) => { set((s) => { const t = { ...s.translated }; delete t[id]; return { translated: t }; }); toast(`Não consegui traduzir: ${msg}`); };
    invoke<string[]>("ai_translate", { config, lines }).then((out) => {
      if (!out) return fail("a tradução só funciona no app nativo");
      set((s) => ({ translated: { ...s.translated, [id]: "done" }, translations: { ...s.translations, [id]: out } }));
      toast(g("aiMode") === "transcribed" ? "Letra transcrita" : "Letra traduzida");
    }).catch((e) => fail(String(e)));
  },
  clearTranslation: (id) => set((s) => { const t = { ...s.translated }, tr = { ...s.translations }; delete t[id]; delete tr[id]; return { translated: t, translations: tr }; }),
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
    { label: "Configurar romanização…", icon: <Type />, onClick: () => nav("settings/romanization") },
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
function ActiveWords({ l, anim, offset, rom }: { l: LyricLine; anim: string; offset: number; rom?: (t: string) => string | null }) {
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
            {rom ? (rom(w.w) ?? w.w) : w.w}
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
  const translation = useLyr((s) => s.translations[track.id]);
  const romAsMain = useSetting<boolean>("romanizeAsMain");
  const size = useSetting<number>("lyricsSize") * scale, spacing = useSetting<number>("lyricsSpacing");
  const align = useSetting<string>("lyricsPosition"), animSetting = useSetting<string>("lyricsAnimation");
  // "Letras MetroMusic" desligado: letra clássica, só a linha ativa em destaque (sem palavra a palavra, desfoque, brilho nem pontos de pausa)
  const metro = useSetting<boolean>("expMetroLyrics") !== false;
  const glow = useSetting<boolean>("lyricsGlow") && metro, blur = useSetting<boolean>("lyricsBlurInactive") && metro, auto = useSetting<boolean>("lyricsAutoScroll");
  const clickSeek = useSetting<boolean>("lyricsClickSeek"), gaps = useSetting<boolean>("lyricsIntervalIndicator") && metro, agents = useSetting<boolean>("lyricsAgentPositioning");
  const anim = metro ? animSetting : "none";
  const box = useRef<HTMLDivElement>(null);
  const [free, setFree] = useState(false); // usuário rolou manualmente
  const freeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const lines = lyrics?.lines ?? [];
  const rom = useRomanizer(lines.map((l) => l.text));
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
                  transform: metro ? (isActive ? "scale(1)" : "scale(0.94)") : undefined,
                  filter: blur && lyrics.synced && !isActive && !free ? `blur(${Math.min(3.5, dist * 0.7)}px)` : undefined,
                  textShadow: isActive && glow ? "0 0 28px color-mix(in oklch, var(--t1) 40%, transparent)" : undefined,
                }}>
                {isActive && anim !== "none" ? <ActiveWords l={l} anim={anim} offset={offset} rom={romAsMain ? rom : undefined} /> : (romAsMain ? (rom(l.text) ?? l.text) : l.text)}
                {(() => { const rl = rom(l.text); return rl ? <div className="font-medium opacity-70 mt-1" style={{ fontSize: "0.55em", lineHeight: 1.3 }}>{romAsMain ? l.text : rl}</div> : null; })()}
                {tr === "done" && translation?.[i] && <div className="font-medium opacity-70 mt-1" style={{ fontSize: "0.5em", lineHeight: 1.3 }}>{translation[i]}</div>}
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

/** Letra atual sob a capa e na barra do player. Com "Linha de letra suave" mostra a anterior, a atual (com brilho que cresce
 *  conforme a linha é cantada) e a próxima; desligada, só a linha atual. */
export function LyricLineNow({ track, className }: { track: Track; className?: string }) {
  const real = useRealLyrics(track);
  const lyrics = useMemo(() => getLyrics(track), [track, real.version]);
  const offset = useLyr((s) => s.offset[track.id] ?? 0);
  const { active } = useActiveLine(lyrics?.lines ?? [], !!lyrics?.synced, offset);
  const smooth = useSetting<boolean>("expSmoothInline") !== false;
  const l = lyrics?.synced && active >= 0 ? lyrics.lines[active] : null;
  const pos = useSmoothTime(offset, !!l);
  const rom = useRomanizer(lyrics?.lines.map((x) => x.text) ?? []);
  const asMain = useSetting<boolean>("romanizeAsMain");
  const show = (x?: LyricLine) => (x ? (asMain ? (rom(x.text) ?? x.text) : x.text) : "");
  const line = l && pos < l.end + 1.5 ? show(l) : "";
  if (!smooth) return <div key={line} className={cx("truncate", className)} style={{ animation: "none" }}>{line || "♪"}</div>;
  const prev = l ? lyrics!.lines[active - 1] : undefined, next = l ? lyrics!.lines[active + 1] : undefined;
  const p = l ? Math.min(1, Math.max(0, (pos - l.t) / Math.max(0.3, l.end - l.t))) : 0;
  const row = "truncate transition-[opacity,filter,transform] duration-500 ease-out";
  return (
    <div className={cx(className?.replace(/\bh-7\b/, ""), "flex flex-col gap-0.5 min-h-[5.4rem] justify-center")} data-smooth-inline>
      <div className={cx(row, "text-[0.82em] opacity-40")} style={{ filter: "blur(0.6px)" }}>{show(prev) || "\u00A0"}</div>
      <div key={line} className={cx(row, "text-t1")} style={{ textShadow: line ? `0 0 ${Math.round(6 + p * 16)}px color-mix(in oklch, var(--t1) ${Math.round(18 + p * 32)}%, transparent)` : undefined }}>{line || "♪"}</div>
      <div className={cx(row, "text-[0.82em] opacity-40")} style={{ filter: "blur(0.6px)" }}>{show(next) || "\u00A0"}</div>
    </div>
  );
}
