import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeCodec, PAYLOAD_OF } from "../../src/lib/lt/protocol.ts";

const codec = makeCodec(readFileSync("src/lib/lt/listentogether.proto", "utf8"));
const track = { id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley", album: "Whenever You Need Somebody", duration: 213000, thumbnail: "https://i.ytimg.com/x.jpg" };

test("envelope com conteúdo: ida e volta", () => {
  const bytes = codec.encode("create_room", { username: "Ana" });
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
  const m = codec.decode(bytes);
  assert.equal(m.type, "create_room");
  assert.equal(m.payload.username, "Ana");
});

test("mensagem sem conteúdo (ping sem dados, request_sync)", () => {
  assert.deepEqual(codec.decode(codec.encode("request_sync")), { type: "request_sync", payload: {} });
  assert.equal(codec.decode(codec.encode("leave_room", {})).type, "leave_room");
});

test("ação de reprodução com faixa, fila e números grandes", () => {
  const m = codec.decode(codec.encode("playback_action", { action: "change_track", trackId: track.id, trackInfo: track, position: 0, volume: 0.5, queue: [track, { ...track, id: "b" }], queueTitle: "Fila", serverTime: 1794342737813 }));
  assert.equal(m.payload.action, "change_track");
  assert.equal(m.payload.trackInfo.title, track.title);
  assert.equal(m.payload.trackInfo.duration, 213000);
  assert.equal(m.payload.queue.length, 2);
  assert.equal(m.payload.serverTime, 1794342737813); // int64 vira number
  assert.ok(Math.abs(m.payload.volume - 0.5) < 1e-6);
});

test("estado da sala recebido do servidor tem listas e padrões", () => {
  const m = codec.decode(codec.encode("join_approved", { roomCode: "ABCD1234", userId: "u1", sessionToken: "tok", state: { roomCode: "ABCD1234", hostId: "h", users: [{ userId: "h", username: "Host", isHost: true, isConnected: true }], isPlaying: true, position: 12000, lastUpdate: 5, volume: 1 } }));
  assert.equal(m.payload.state.users[0].username, "Host");
  assert.deepEqual(m.payload.state.queue, []); // lista ausente vira vazia
  assert.equal(m.payload.state.currentTrack, null);
  assert.equal(m.payload.state.isPlaying, true);
});

test("tipos desconhecidos são recusados na ida e preservados na volta", () => {
  assert.throws(() => codec.encode("tipo_inexistente", {}), /desconhecida/);
  // mensagem nova do servidor que o cliente não conhece: o tipo chega, o conteúdo fica vazio
  const raw = codec.encode("ping", { clientTime: 1 });
  assert.equal(codec.decode(raw).type, "ping");
  assert.ok(Object.keys(PAYLOAD_OF).includes("sync_playback") && Object.keys(PAYLOAD_OF).includes("room_created"));
});

test("conteúdo comprimido (gzip) é descomprimido na volta", () => {
  const big = { roomCode: "R", hostId: "h", users: [], queue: Array.from({ length: 40 }, (_, i) => ({ ...track, id: `v${i}` })), isPlaying: false, position: 0, lastUpdate: 0, volume: 1 };
  const plain = codec.encode("join_approved", { roomCode: "R", userId: "u", sessionToken: "t", state: big });
  const zipped = codec.encode("join_approved", { roomCode: "R", userId: "u", sessionToken: "t", state: big }, true);
  assert.ok(zipped.length < plain.length / 2, `${zipped.length} vs ${plain.length}`);
  const m = codec.decode(zipped);
  assert.equal(m.payload.state.queue.length, 40);
  assert.equal(m.payload.state.queue[39].id, "v39");
});
