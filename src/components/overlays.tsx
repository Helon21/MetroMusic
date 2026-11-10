import { tr } from "../i18n";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownToLine, Check, ChevronRight, CornerDownLeft, Heart, ListEnd, ListPlus, ListStart, Play, Search, Shuffle, Trash2, X } from "lucide-react";
import { albums, artistOf, artists, getArtist, songs } from "../lib/catalog";
import { tracksMenu } from "../lib/menus";
import { PAGES } from "../lib/settingsSchema";
import { cx, norm } from "../lib/util";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { nav, openDialog, useUI, type MenuItem } from "../store/ui";
import { Btn, Cover, IconBtn, Kbd } from "./ui";

// ───────── Menu de contexto
function MenuList({ items, x, y, onClose, depth = 0 }: { items: MenuItem[]; x: number; y: number; onClose: () => void; depth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!; const r = el.getBoundingClientRect(); const pad = 8;
    let nx = x, ny = y;
    if (nx + r.width > innerWidth - pad) nx = depth ? x - r.width - 232 : innerWidth - r.width - pad;
    if (ny + r.height > innerHeight - pad) ny = Math.max(pad, innerHeight - r.height - pad);
    setPos({ x: Math.max(pad, nx), y: ny, ready: true });
  }, [x, y, depth]);
  return (
    <>
      <motion.div ref={ref} role="menu" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: pos.ready ? 1 : 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.12 }}
        style={{ left: pos.x, top: pos.y, boxShadow: "var(--shadow)", transformOrigin: "top left" }} className="fixed z-[90] w-60 max-h-[80vh] overflow-y-auto p-1.5 rounded-xl bg-s2/95 backdrop-blur-xl">
        {items.map((it, i) =>
          it.divider ? <div key={i} className="h-px bg-line my-1.5 mx-2" />
          : it.header ? <div key={i} className="px-3 pt-1.5 pb-1 text-[0.72rem] font-semibold uppercase tracking-wider text-t3">{tr(it.label)}</div>
          : (
            <button key={i} role="menuitem" disabled={it.disabled}
              onMouseEnter={(e) => { if (it.sub) { const r = e.currentTarget.getBoundingClientRect(); setSub({ i, x: r.right + 2, y: r.top - 6 }); } else setSub(null); }}
              onClick={() => { if (it.sub) return; it.onClick?.(); onClose(); }}
              className={cx("w-full h-9 px-2.5 rounded-lg flex items-center gap-2.5 text-left text-[0.9rem] transition-colors disabled:opacity-40 disabled:pointer-events-none [&>svg]:size-4 [&>svg]:shrink-0",
                it.danger ? "text-danger hover:bg-danger/12" : "hover:bg-s3", sub?.i === i && "bg-s3")}>
              {it.icon ?? (it.checked !== undefined ? <span className="size-4 shrink-0" /> : null)}
              <span className="flex-1 truncate">{tr(it.label)}</span>
              {it.checked && <Check className="text-accent" />}
              {it.hint && <span className="text-t3 text-[0.76rem]">{it.hint}</span>}
              {it.sub && <ChevronRight className="text-t3" />}
            </button>
          ))}
      </motion.div>
      {sub && items[sub.i]?.sub && <MenuList key={sub.i} items={items[sub.i].sub!} x={sub.x} y={sub.y} onClose={onClose} depth={depth + 1} />}
    </>
  );
}
export function ContextMenu() {
  const menu = useUI((s) => s.menu), close = useUI((s) => s.closeMenu);
  return (
    <AnimatePresence>
      {menu && (
        <div key={`${menu.x}-${menu.y}`}>
          <div className="fixed inset-0 z-[89]" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />
          <MenuList items={menu.items} x={menu.x} y={menu.y} onClose={close} />
        </div>
      )}
    </AnimatePresence>
  );
}

// ───────── Toasts
export function Toasts() {
  const toasts = useUI((s) => s.toasts), dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-28 z-[95] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={{ type: "spring", stiffness: 480, damping: 34 }}
            style={{ boxShadow: "var(--shadow)" }} className="pointer-events-auto flex items-center gap-3 h-11 pl-4 pr-2 rounded-full bg-t1 text-bg font-medium text-[0.9rem]">
            <span className="max-w-[26rem] truncate">{tr(t.text)}</span>
            {t.action ? <button className="h-7.5 px-3 rounded-full bg-bg/15 hover:bg-bg/25 text-[0.84rem] font-semibold" onClick={() => { t.action!.fn(); dismiss(t.id); }}>{tr(t.action.label)}</button>
              : <button aria-label={tr("Dispensar")} className="size-7 grid place-items-center rounded-full hover:bg-bg/15" onClick={() => dismiss(t.id)}><X className="size-4" /></button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ───────── Barra de seleção múltipla
export function SelectionBar() {
  const sel = useUI((s) => s.sel), setSel = useUI((s) => s.setSel), openMenuAt = useUI((s) => s.openMenuAt);
  const show = sel.length > 1;
  const P = usePlayer.getState(), L = useLib.getState();
  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: "spring", stiffness: 460, damping: 34 }}
          style={{ boxShadow: "var(--shadow)" }} className="absolute left-1/2 -translate-x-1/2 bottom-5 z-30 flex items-center gap-1 h-13 pl-5 pr-2 rounded-full bg-s2/95 backdrop-blur-xl">
          <span className="font-semibold mr-3 tnum whitespace-nowrap">{sel.length} selecionadas</span>
          <IconBtn label="Tocar" onClick={() => P.play(sel, 0, "Seleção")}><Play /></IconBtn>
          <IconBtn label="Embaralhar" onClick={() => P.play(sel, 0, "Seleção", { shuffle: true })}><Shuffle /></IconBtn>
          <IconBtn label="Tocar a seguir" onClick={() => P.playNext(sel)}><ListStart /></IconBtn>
          <IconBtn label="Adicionar à fila" onClick={() => P.addToQueue(sel)}><ListEnd /></IconBtn>
          <IconBtn label="Adicionar à playlist" onClick={(e) => openMenuAt(e.currentTarget, tracksMenu(sel).find((m) => m.sub)!.sub!)}><ListPlus /></IconBtn>
          <IconBtn label="Curtir todas" onClick={() => L.setLiked(sel, true)}><Heart /></IconBtn>
          <IconBtn label="Baixar" onClick={() => L.download(sel)}><ArrowDownToLine /></IconBtn>
          <div className="w-px h-6 bg-line mx-1.5" />
          <IconBtn label="Limpar seleção (Esc)" onClick={() => setSel([])}><X /></IconBtn>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────── Paleta de comandos (Ctrl+K)
interface Cmd { label: string; sub?: string; group: string; run: () => void; cover?: { hue: number; seed: number; artist?: boolean }; kbd?: string }
export function CommandPalette() {
  const open = useUI((s) => s.palette), setOpen = useUI((s) => s.setPalette);
  const [q, setQ] = useState(""); const [i, setI] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQ(""); setI(0); } }, [open]);
  const cmds = useMemo<Cmd[]>(() => {
    if (!open) return [];
    const P = usePlayer.getState(), U = useUI.getState();
    const base: Cmd[] = [
      { label: "Início", group: "Ir para", run: () => nav("home") }, { label: "Explorar", group: "Ir para", run: () => nav("explore") },
      { label: "Biblioteca", group: "Ir para", run: () => nav("library/playlists") }, { label: "Músicas curtidas", group: "Ir para", run: () => nav("playlist/liked") },
      { label: "Baixadas", group: "Ir para", run: () => nav("playlist/downloaded") }, { label: "Histórico", group: "Ir para", run: () => nav("history") },
      { label: "Estatísticas", group: "Ir para", run: () => nav("stats") }, { label: "Retrospectiva", group: "Ir para", run: () => nav("wrapped") },
      { label: "Ouvir junto", group: "Ir para", run: () => nav("together") }, { label: "Reconhecer música", group: "Ir para", run: () => nav("recognize") },
      { label: "Equalizador", group: "Ir para", run: () => nav("equalizer") }, { label: "Conta", group: "Ir para", run: () => nav("account") },
      { label: "Tocar / pausar", group: "Player", kbd: "Espaço", run: () => P.toggle() }, { label: "Próxima música", group: "Player", kbd: "Ctrl →", run: () => P.next() },
      { label: "Música anterior", group: "Player", kbd: "Ctrl ←", run: () => P.prev() }, { label: "Alternar aleatório", group: "Player", kbd: "S", run: () => P.toggleShuffle() },
      { label: "Alternar repetição", group: "Player", kbd: "R", run: () => P.cycleRepeat() }, { label: "Abrir Tocando agora", group: "Player", kbd: "F", run: () => U.setNowPlaying(true) },
      { label: "Mostrar fila", group: "Player", kbd: "Q", run: () => U.setPanel("queue") }, { label: "Mostrar letra", group: "Player", kbd: "Y", run: () => U.setPanel("lyrics") },
      { label: "Timer de sono…", group: "Player", run: () => openDialog("sleep") }, { label: "Velocidade e tom…", group: "Player", run: () => openDialog("tempo") },
      { label: "Nova playlist…", group: "Ações", run: () => openDialog("createPlaylist") }, { label: "Importar playlist…", group: "Ações", run: () => openDialog("import") },
      { label: U.online ? "Simular modo offline" : "Voltar a ficar online", group: "Ações", run: () => U.setOnline(!U.online) },
      { label: "Atalhos de teclado", group: "Ações", kbd: "?", run: () => openDialog("shortcuts") },
      ...PAGES.map((p): Cmd => ({ label: `Configurações: ${p.title}`, sub: p.desc, group: "Configurações", run: () => nav(`settings/${p.id}`) })),
    ];
    const n = norm(q.trim());
    if (!n) return base.slice(0, 14);
    const hit = (s: string) => norm(s).includes(n);
    return [
      ...base.filter((c) => hit(c.label) || (c.sub && hit(c.sub))).slice(0, 7),
      ...artists.filter((a) => hit(a.name)).slice(0, 3).map((a): Cmd => ({ label: a.name, sub: "Artista", group: "Catálogo", cover: { hue: a.hue, seed: a.seed, artist: true }, run: () => nav(`artist/${a.id}`) })),
      ...albums.filter((a) => hit(a.title)).slice(0, 3).map((a): Cmd => ({ label: a.title, sub: `Álbum · ${getArtist(a.artistId)?.name}`, group: "Catálogo", cover: a, run: () => nav(`album/${a.id}`) })),
      ...songs.filter((t) => hit(t.title)).slice(0, 5).map((t): Cmd => ({ label: t.title, sub: `Música · ${artistOf(t)}`, group: "Catálogo", cover: t, run: () => P.play([t.id], 0, "Busca") })),
      { label: `Buscar "${q.trim()}"`, group: "Busca", run: () => nav(`search/${encodeURIComponent(q.trim())}`) },
    ];
  }, [q, open]);
  useEffect(() => setI(0), [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" }); }, [i]);
  const run = (c?: Cmd) => { if (!c) return; setOpen(false); c.run(); };
  let last = "";
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex justify-center items-start pt-[14vh] bg-black/50 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <motion.div initial={{ y: -12, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ scale: 0.98, opacity: 0 }} transition={{ type: "spring", stiffness: 520, damping: 36 }} style={{ boxShadow: "var(--shadow)" }} className="w-[38rem] max-w-[92vw] rounded-2xl bg-s1 overflow-hidden">
            <div className="flex items-center gap-3 px-5 h-14 border-b border-line">
              <Search className="size-5 text-t3" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Buscar músicas, telas, ações e configurações…")} className="flex-1 bg-transparent text-[1.02rem] placeholder:text-t3"
                onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(cmds.length - 1, v + 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(0, v - 1)); } else if (e.key === "Enter") run(cmds[i]); else if (e.key === "Escape") setOpen(false); }} />
              <Kbd>Esc</Kbd>
            </div>
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {cmds.map((c, k) => {
                const head = c.group !== last ? ((last = c.group), <div className="px-3 pt-2.5 pb-1 text-[0.72rem] font-semibold uppercase tracking-wider text-t3">{c.group}</div>) : null;
                return (
                  <div key={k}>{head}
                    <button data-i={k} onMouseMove={() => setI(k)} onClick={() => run(c)} className={cx("w-full h-11 px-3 rounded-lg flex items-center gap-3 text-left", k === i && "bg-s2")}>
                      {c.cover && <Cover hue={c.cover.hue} seed={c.cover.seed} artist={c.cover.artist} className="size-8 rounded-md" />}
                      <span className="flex-1 min-w-0"><span className="block truncate">{c.label}</span></span>
                      {c.sub && <span className="text-t3 text-[0.82rem] truncate max-w-[45%]">{c.sub}</span>}
                      {c.kbd && <Kbd>{c.kbd}</Kbd>}
                      {k === i && <CornerDownLeft className="size-4 text-t3" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmFooter({ onCancel, onConfirm, confirm = "Confirmar", danger, disabled }: { onCancel: () => void; onConfirm: () => void; confirm?: string; danger?: boolean; disabled?: boolean }) {
  return <><Btn variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn variant={danger ? "danger" : "primary"} icon={danger ? <Trash2 /> : undefined} onClick={onConfirm} disabled={disabled}>{confirm}</Btn></>;
}
