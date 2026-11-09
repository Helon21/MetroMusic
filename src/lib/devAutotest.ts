// Teste automático do fluxo de reprodução, só em desenvolvimento e só no app nativo.
// Roda com:  MM_AUTOTEST=1 pnpm tauri dev   (o resultado sai no log do Vite, linhas "[autotest]").
// Toca em silêncio (volume 0) e devolve o volume e a fila originais no fim.

import { registerTrack } from "./catalog";
import { engine } from "./engine";
import { usePlayer } from "../store/player";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const P = () => usePlayer.getState();

async function until(what: string, ok: () => boolean, timeoutMs = 25000) {
  const t0 = performance.now();
  while (!ok()) {
    if (performance.now() - t0 > timeoutMs) throw new Error(`tempo esgotado: ${what}`);
    await sleep(50);
  }
  return Math.round(performance.now() - t0);
}

export async function runAutotest(log: (m: string) => void) {
  const saved = { volume: P().volume, muted: P().muted, queue: P().queue, index: P().index, title: P().queueTitle };
  const fail: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); log(`ok   ${name}`); }
    catch (e) { fail.push(name); log(`FALHA ${name}: ${e instanceof Error ? e.message : e}`); }
  };
  P().setVolume(0);
  try {
    for (const provider of ["youtube", "soundcloud", "deezer"]) {
      let ids: string[] = [];
      await step(`busca ${provider}`, async () => {
        const list = (await engine.search(provider, "daft punk get lucky", 8)) ?? [];
        if (!list.length) throw new Error("sem resultados");
        ids = list.map((i) => registerTrack(i).id);
        log(`     ${list.length} resultados, 1º: ${list[0].title} — ${list[0].artists.join(", ")}`);
      });
      if (!ids.length) continue;
      await step(`toca ${provider}`, async () => {
        const t0 = performance.now();
        P().play(ids, 0, `autotest ${provider}`);
        await until("começar a tocar", () => P().playing && !P().buffering && P().position > 0.4);
        const info = P().info;
        log(`     tocando em ${Math.round(performance.now() - t0)} ms, fonte=${info?.source} codec=${info?.codec} ${Math.round((info?.bitrate ?? 0) / 1000)} kbps`);
      });
      await step(`busca temporal ${provider}`, async () => {
        P().seek(60);
        await until("posição ≥ 60 s", () => P().position >= 60 && P().position < 70, 12000);
        log(`     posição após seek(60): ${P().position.toFixed(1)} s`);
      });
      await step(`pausa/retoma ${provider}`, async () => {
        P().toggle(); await sleep(700);
        const a = P().position; await sleep(900);
        if (Math.abs(P().position - a) > 0.1) throw new Error(`andou em pausa: ${a} -> ${P().position}`);
        P().toggle();
        await until("retomar", () => P().playing && P().position > a);
      });
      if (provider === "youtube") {
        await step("pré-cache das próximas", async () => {
          await sleep(2500);
          const s = await engine.cacheStats();
          log(`     cache: ${s?.entries} entradas, ${Math.round((s?.bytes ?? 0) / 1024)} KiB`);
          if (!s || s.entries < 3) throw new Error("o pré-cache não encheu");
        });
        await step("próxima faixa (pré-carregada)", async () => {
          const t0 = performance.now();
          P().next();
          await until("começar a próxima", () => P().playing && !P().buffering && P().position > 0.4);
          log(`     próxima começou em ${Math.round(performance.now() - t0)} ms`);
        });
      }
    }
  } finally {
    P().setVolume(saved.volume); if (saved.muted) P().toggleMute();
    usePlayer.setState({ queue: saved.queue, index: saved.index, queueTitle: saved.title, playing: false });
    engine.stop();
  }
  log(fail.length ? `FIM com ${fail.length} falha(s): ${fail.join(", ")}` : "FIM sem falhas");
}

/** Deixa o app numa tela com resultados reais e uma faixa tocando em silêncio, para conferir o visual. */
export async function runShow(log: (m: string) => void) {
  const { useUI } = await import("../store/ui");
  P().setVolume(0);
  const list = (await engine.search("youtube", "daft punk get lucky", 12)) ?? [];
  const ids = list.map((i) => registerTrack(i).id);
  useUI.getState().nav(`search/${encodeURIComponent("daft punk get lucky")}`);
  P().play(ids, 0, "Busca: daft punk get lucky");
  await until("tocar", () => P().playing && !P().buffering && P().position > 1);
  useUI.getState().setPanel("queue");
  log(`pronto: ${ids.length} resultados, tocando ${P().info?.codec}`);
}
