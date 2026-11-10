// Detecção de lentidão gráfica (funções puras, testadas em scripts/tests/perfDetect.test.mjs).

/** O nome do renderizador de WebGL indica desenho por software (sem GPU de verdade)? */
export function isSoftwareRenderer(name: string | null | undefined): boolean {
  if (!name) return false;
  return /swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic render|mesa offscreen|cpu renderer|angle \(.*(swiftshader|llvmpipe)/i.test(name);
}

/**
 * Monitor de quadros: recebe o intervalo entre quadros (ms) e decide se o app está lento.
 * Cada janela de `windowMs` vira uma média; `needed` janelas lentas seguidas decidem "lento".
 */
export class FrameMonitor {
  private sum = 0; private n = 0; private slow = 0; private elapsed = 0;
  private opts: { windowMs: number; minFps: number; needed: number };
  constructor(opts: { windowMs: number; minFps: number; needed: number } = { windowMs: 2000, minFps: 40, needed: 3 }) { this.opts = opts; }

  /** Devolve `true` no momento em que a lentidão fica confirmada. `ignore`: descarta o quadro (janela escondida, sem foco, carregando). */
  push(dt: number, ignore = false): boolean {
    if (ignore || !(dt > 0) || dt > 1000) { this.sum = 0; this.n = 0; this.elapsed = 0; this.slow = 0; return false; } // pausa longa não conta como lentidão
    this.sum += dt; this.n++; this.elapsed += dt;
    if (this.elapsed < this.opts.windowMs) return false;
    const fps = 1000 / (this.sum / this.n);
    this.sum = 0; this.n = 0; this.elapsed = 0;
    this.slow = fps < this.opts.minFps ? this.slow + 1 : 0;
    return this.slow >= this.opts.needed;
  }
}

/** Dica guardada de uma execução anterior ainda vale? (o PC ou o driver pode ter mudado) */
export function hintIsFresh(hint: { low: boolean; at: number } | null | undefined, now = Date.now(), days = 3): boolean {
  return !!hint && hint.low === true && now - hint.at < days * 24 * 3600 * 1000;
}
