import test from "node:test";
import assert from "node:assert/strict";
import { backupName, buildBackup, parseBackup, referencedTrackIds } from "../../src/lib/backup.ts";

const lib = { liked: ["youtube:a"], playlists: [{ id: "u1", title: "P", trackIds: ["youtube:b", "demo1"] }], history: [{ id: "youtube:c", at: 1 }], counts: { "youtube:a": 3 }, accounts: { youtube: "cadu" }, downloads: { x: 1 }, folders: ["/musica"] };

test("o backup não leva segredos, contas nem arquivos de disco", () => {
  const b = buildBackup({ settings: { palette: "blue", aiKey: "sk-123", proxyPass: "x" }, library: lib, tracks: [], now: new Date("2026-11-10T10:00:00Z") });
  const txt = JSON.stringify(b);
  assert.ok(!txt.includes("sk-123") && !txt.includes("proxyPass") && !txt.includes("accounts") && !txt.includes("downloads"));
  assert.equal(b.settings.palette, "blue");
  assert.deepEqual(b.library.liked, ["youtube:a"]);
});
test("ida e volta preserva os dados", () => {
  const b = buildBackup({ settings: { crossfade: true }, library: lib, tracks: [{ provider: "youtube", id: "a" }] });
  const p = parseBackup(JSON.stringify(b));
  assert.ok(p.ok);
  assert.deepEqual(p.data.library, b.library);
  assert.deepEqual(p.data.settings, { crossfade: true });
  assert.equal(p.data.tracks.length, 1);
});
test("rejeita arquivos inválidos com mensagem clara", () => {
  assert.match(parseBackup("{ não json").error, /JSON/);
  assert.match(parseBackup(JSON.stringify({ app: "Outro" })).error, /não é um backup/);
  assert.match(parseBackup(JSON.stringify({ app: "MetroMusic", version: 99, settings: {}, library: {}, tracks: [] })).error, /mais nova/);
  assert.match(parseBackup(JSON.stringify({ app: "MetroMusic", version: 1, settings: {}, library: { liked: "x" }, tracks: [] })).error, /corrompido/);
  assert.match(parseBackup(JSON.stringify({ app: "MetroMusic", version: 1, settings: {}, tracks: [] })).error, /incompleto/);
});
test("um backup adulterado não consegue injetar segredos nem chaves estranhas", () => {
  const p = parseBackup(JSON.stringify({ app: "MetroMusic", version: 1, settings: { aiKey: "roubada", palette: "red" }, library: { liked: [], accounts: { x: "y" }, hack: 1 }, tracks: [] }));
  assert.ok(p.ok);
  assert.deepEqual(p.data.settings, { palette: "red" });
  assert.deepEqual(Object.keys(p.data.library), ["liked"]);
});
test("faixas citadas e nome do arquivo", () => {
  assert.deepEqual(referencedTrackIds(lib).sort(), ["youtube:a", "youtube:b", "youtube:c"]);
  assert.equal(backupName(new Date(2026, 10, 9)), "MetroMusic-2026-11-09.backup");
});
