import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { cx } from "../lib/util";
import { currentWindow, hasOwnControls } from "../lib/native";

/** Minimizar, maximizar e fechar para Windows e Linux (no macOS ficam os botões do sistema). */
export function WindowControls({ className }: { className?: string }) {
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!hasOwnControls) return;
    let off: (() => void) | undefined; let dead = false;
    (async () => {
      const w = await currentWindow();
      const sync = async () => { if (!dead) setMax(await w.isMaximized()); };
      sync();
      off = await w.onResized(sync);
    })();
    return () => { dead = true; off?.(); };
  }, []);
  if (!hasOwnControls) return null;
  const run = async (fn: (w: Awaited<ReturnType<typeof currentWindow>>) => Promise<void>) => fn(await currentWindow());
  const base = "h-8 w-11 grid place-items-center rounded-md text-t2 transition-colors [&>svg]:size-4";
  return (
    <div className={cx("flex items-center gap-0.5 ml-2 -mr-2", className)}>
      <button aria-label="Minimizar" title="Minimizar" className={cx(base, "hover:bg-s2 hover:text-t1")} onClick={() => run((w) => w.minimize())}><Minus /></button>
      <button aria-label={max ? "Restaurar" : "Maximizar"} title={max ? "Restaurar" : "Maximizar"} className={cx(base, "hover:bg-s2 hover:text-t1")} onClick={() => run((w) => w.toggleMaximize())}>{max ? <Copy className="-scale-x-100" /> : <Square className="!size-3.5" />}</button>
      <button aria-label="Fechar" title="Fechar" className={cx(base, "hover:bg-danger hover:text-white")} onClick={() => run((w) => w.close())}><X /></button>
    </div>
  );
}
