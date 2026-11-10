import test from "node:test";
import assert from "node:assert/strict";
import { isSoftwareRenderer, FrameMonitor, hintIsFresh } from "../../src/lib/perfDetect.ts";

test("renderizadores de software são reconhecidos; GPU de verdade não", () => {
  for (const r of ["Google SwiftShader", "llvmpipe (LLVM 15.0.7, 256 bits)", "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", "Microsoft Basic Render Driver", "softpipe", "Software Rasterizer"])
    assert.equal(isSoftwareRenderer(r), true, r);
  for (const r of ["NVIDIA GeForce RTX 4070 SUPER/PCIe/SSE2", "Mesa Intel(R) UHD Graphics 630 (CFL GT2)", "AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49)", "Apple M2", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)"])
    assert.equal(isSoftwareRenderer(r), false, r);
  assert.equal(isSoftwareRenderer(null), false);
  assert.equal(isSoftwareRenderer(""), false);
});

test("60 fps constantes nunca disparam", () => {
  const m = new FrameMonitor();
  for (let i = 0; i < 60 * 30; i++) assert.equal(m.push(16.7), false);
});

test("lentidão sustentada (20 fps) é confirmada depois de 3 janelas", () => {
  const m = new FrameMonitor();
  let when = -1;
  for (let i = 0; i < 20 * 20 && when < 0; i++) if (m.push(50)) when = i;
  assert.ok(when > 0, "deveria confirmar");
  assert.ok(when >= 20 * 6 - 2 && when <= 20 * 6 + 2, `confirmou no quadro ${when} (esperado perto de 120, ~6 s)`);
});

test("um engasgo isolado não conta: a sequência de janelas lentas precisa ser seguida", () => {
  const m = new FrameMonitor();
  let hit = false;
  for (let round = 0; round < 8; round++) {
    // cada rodada dura uma janela inteira (2 s): lenta (40 × 50 ms), rápida (120 × ~16,7 ms), lenta, rápida…
    const [frames, dt] = round % 2 ? [40, 50] : [121, 16.7];
    for (let i = 0; i < frames; i++) hit ||= m.push(dt);
  }
  assert.equal(hit, false);
});

test("janela escondida ou sem foco zera a contagem, e uma pausa longa não vira lentidão", () => {
  const m = new FrameMonitor();
  for (let i = 0; i < 60; i++) m.push(50); // 3 s lentos…
  assert.equal(m.push(16.7, true), false); // …mas a janela perdeu o foco: recomeça
  for (let i = 0; i < 60; i++) assert.equal(m.push(50), false); // precisa de mais 3 janelas do zero
  const k = new FrameMonitor();
  for (let i = 0; i < 100; i++) assert.equal(k.push(i === 50 ? 5000 : 16.7), false); // aba dormiu 5 s
});

test("a dica de uma execução anterior vale por 3 dias", () => {
  const now = 1_000_000_000_000;
  assert.equal(hintIsFresh({ low: true, at: now - 2 * 86400_000 }, now), true);
  assert.equal(hintIsFresh({ low: true, at: now - 4 * 86400_000 }, now), false);
  assert.equal(hintIsFresh({ low: false, at: now }, now), false);
  assert.equal(hintIsFresh(null, now), false);
});
