import test from "node:test";
import assert from "node:assert/strict";
import { liveBitrate } from "../../src/lib/liveBitrate.ts";

const flac = { key: "k", source: "local", codec: "flac", bitrate: 900_000 };

test("FLAC acompanha a taxa medida quando ela muda de verdade", () => {
  assert.deepEqual(liveBitrate(flac, 1_050_000, true), { ...flac, bitrate: 1_050_000 });
  assert.equal(liveBitrate(flac, 910_000, true), null); // menos de 3%: não redesenha
});

test("opção desligada, sem medida ou sem faixa: nada muda", () => {
  assert.equal(liveBitrate(flac, 1_200_000, false), null);
  assert.equal(liveBitrate(flac, 0, true), null);
  assert.equal(liveBitrate(flac, undefined, true), null);
  assert.equal(liveBitrate(null, 1_200_000, true), null);
});

test("taxa constante (AAC, Opus) não é mexida", () => {
  assert.equal(liveBitrate({ ...flac, codec: "aac", bitrate: 129_000 }, 200_000, true), null);
  assert.equal(liveBitrate({ ...flac, codec: "opus", bitrate: 160_000 }, 100_000, true), null);
});

test("MP3, Vorbis e ALAC contam como taxa variável", () => {
  for (const c of ["mp3", "vorbis", "alac", "FLAC"]) assert.ok(liveBitrate({ ...flac, codec: c, bitrate: 128_000 }, 256_000, true), c);
});
