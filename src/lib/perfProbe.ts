// Sonda de desempenho SÓ para desenvolvimento: mede a taxa de quadros real do webview
// (ociosa, rolando a página e trocando de faixa) e escreve no console.
import { usePlayer } from "../store/player";
import { useUI } from "../store/ui";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function frames(ms: number, step?: () => void) {
  const dts: number[] = []; let last = performance.now(); const t0 = last;
  await new Promise<void>((done) => {
    const f = (t: number) => { dts.push(t - last); last = t; step?.(); if (t - t0 < ms) requestAnimationFrame(f); else done(); };
    requestAnimationFrame(f);
  });
  dts.shift();
  const s = [...dts].sort((a, b) => a - b), q = (p: number) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
  const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
  return { fps: +(1000 / mean).toFixed(1), p50: q(0.5), p95: q(0.95), max: +s[s.length - 1].toFixed(1), lentos: dts.filter((d) => d > 1.6 * s[Math.floor(s.length / 2)]).length, n: dts.length };
}

export async function runPerfProbe(log: (m: string) => void) {
  const el = () => document.getElementById("main-scroll")!;
  const scrolling = () => { let dir = 1; return () => { const e = el(); e.scrollTop += dir * 22; if (e.scrollTop <= 0) dir = 1; else if (e.scrollTop + e.clientHeight >= e.scrollHeight - 2) dir = -1; }; };
  const run = async (label: string, ms: number, step?: () => void) => log(`${label}: ${JSON.stringify(await frames(ms, step))}`);
  const P = usePlayer.getState();
  const ui = useUI.getState();

  await run("ocioso (taxa de quadros do webview)", 1500);
  ui.nav("home"); await sleep(1500);
  if (P.playing) P.toggle();
  await run("rolando Início, pausado", 3000, scrolling());
  if (!usePlayer.getState().playing) usePlayer.getState().toggle();
  await run("rolando Início, tocando", 3000, scrolling());
  ui.nav("library/songs"); await sleep(1500);
  await run("rolando Músicas (lista longa), tocando", 3000, scrolling());
  ui.nav("playlist/liked"); await sleep(1500);
  await run("rolando playlist, tocando", 3000, scrolling());
  // troca de faixa: o maior quadro mostra se a thread principal trava
  const t = performance.now(); usePlayer.getState().next();
  log(`troca de faixa: ${JSON.stringify(await frames(1500))} (início em ${(performance.now() - t).toFixed(0)} ms)`);
  log("fim da sonda");
}
