import test from "node:test";
import assert from "node:assert/strict";
import { toneFromPixels } from "../../src/lib/coverTone.ts";

const px = (rgb, n = 100) => Array.from({ length: n }, () => [...rgb, 255]).flat();

test("capa escura e capa clara", () => {
  assert.ok(toneFromPixels(px([10, 10, 20])).light < 0.1);
  assert.ok(toneFromPixels(px([240, 240, 235])).light > 0.9);
});

test("cinza, preto e branco não viram cor; um vermelho vivo sim", () => {
  assert.deepEqual(toneFromPixels([...px([0, 0, 0]), ...px([255, 255, 255]), ...px([128, 128, 128])]).colors, []);
  const t = toneFromPixels(px([220, 30, 40]));
  assert.equal(t.colors.length, 1);
  const hue = Number(/hsl\((\d+)/.exec(t.colors[0])[1]);
  assert.ok(hue < 10 || hue > 350, `matiz ${hue}`);
});

test("até três cores, da mais presente para a menos", () => {
  const t = toneFromPixels([...px([30, 80, 220], 300), ...px([220, 30, 40], 200), ...px([40, 200, 60], 100), ...px([230, 200, 20], 50)]);
  assert.equal(t.colors.length, 3);
  assert.ok(/hsl\((2\d\d)/.test(t.colors[0]), `a primeira deveria ser o azul: ${t.colors[0]}`);
});

test("pixels transparentes são ignorados e entrada vazia não quebra", () => {
  assert.deepEqual(toneFromPixels([255, 0, 0, 0, 255, 0, 0, 0]).colors, []);
  assert.equal(toneFromPixels([]).colors.length, 0);
});
