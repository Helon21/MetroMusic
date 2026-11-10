import { isLowPerf } from "./perf";
// Relógio suave da reprodução. O motor informa a posição 4 vezes por segundo (e a simulação, 10);
// para a letra acompanhar a fala sem "pulinhos", interpolamos entre os avisos com o relógio do navegador.
import { useEffect, useRef, useState } from "react";
import { usePlayer } from "../store/player";
import { getSetting } from "../store/settings";

/** Intervalo mínimo entre quadros a 60 fps, com folga para a variação do relógio do quadro. */
const FRAME_60 = 1000 / 60 - 1.5;
/** Modo leve: a letra anima a 30 quadros por segundo. */
const FRAME_30 = 1000 / 30 - 2;
import type { LyricLine } from "./catalog";

let a = { pos: 0, at: performance.now(), running: false, speed: 1 };
const estimate = () => (a.running ? a.pos + ((performance.now() - a.at) / 1000) * a.speed : a.pos);

function anchor() {
  const s = usePlayer.getState();
  return { pos: s.position, at: performance.now(), running: s.playing && !s.buffering, speed: s.speed };
}
a = anchor();
usePlayer.subscribe((s, prev) => {
  if (s.position === prev.position && s.playing === prev.playing && s.buffering === prev.buffering && s.speed === prev.speed) return;
  const now = anchor();
  const e = estimate();
  // aviso quase igual à estimativa: só corrige aos poucos, para o tempo nunca andar para trás
  if (a.running && now.running && Math.abs(now.pos - e) < 0.4) a = { ...now, pos: e + (now.pos - e) * 0.3 };
  else a = now;
});

/** Posição atual da reprodução, em segundos, interpolada. */
export const playerNow = () => estimate();

/** Tempo que se atualiza a cada quadro. Use só em componentes pequenos. */
export function useSmoothTime(offset = 0, enabled = true) {
  const [t, setT] = useState(() => playerNow() + offset);
  useEffect(() => {
    if (!enabled) return;
    let id = 0, last = 0;
    const f = (now: number) => {
      id = requestAnimationFrame(f);
      // "Letras a 120 fps" desligado: em telas de taxa alta, atualiza no máximo ~60 vezes por segundo
      if (now - last < (isLowPerf() ? FRAME_30 : !getSetting("lyricsHighRefresh") ? FRAME_60 : 0)) return;
      last = now;
      setT(playerNow() + offset);
    };
    id = requestAnimationFrame(f);
    return () => cancelAnimationFrame(id);
  }, [offset, enabled]);
  return t;
}

/** Linha ativa e se estamos num intervalo instrumental; só renderiza quando algum dos dois muda. */
export function useActiveLine(lines: LyricLine[], synced: boolean, offset: number) {
  const compute = (p: number) => {
    let active = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].t <= p) active = i; else break; }
    const inGap = active >= 0 ? p > lines[active].end + 0.6 && (lines[active + 1]?.t ?? Infinity) - lines[active].end > 5 : (lines[0]?.t ?? 0) > 5;
    return { active, inGap };
  };
  const [st, setSt] = useState(() => compute(playerNow() + offset));
  const last = useRef(st);
  useEffect(() => {
    if (!synced) return;
    let id = 0;
    const f = () => {
      const n = compute(playerNow() + offset);
      if (n.active !== last.current.active || n.inGap !== last.current.inGap) { last.current = n; setSt(n); }
      id = requestAnimationFrame(f);
    };
    f();
    return () => cancelAnimationFrame(id);
  }, [lines, synced, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  // a letra pode ter mudado (outra faixa, ou chegou agora) antes de o efeito recalcular: nunca devolve índice fora dela
  return st.active < lines.length ? st : { active: -1, inGap: false };
}
