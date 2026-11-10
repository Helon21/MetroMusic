// Teste de verdade do Ouvir junto contra o servidor público (precisa de internet). Uso: node scripts/net/lt.net.mjs [wss://…]
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { makeCodec } from "../../src/lib/lt/protocol.ts";
import { LTClient } from "../../src/lib/lt/client.ts";

const url = process.argv[2] ?? "wss://metroserverx.meowery.eu/ws";
const codec = makeCodec(readFileSync("src/lib/lt/listentogether.proto", "utf8"));
const waiters = [];
function make(name) {
  const inbox = [];
  const c = new LTClient({ codec, url, onMessage: (type, payload) => { inbox.push({ type, payload }); waiters.forEach((w) => w()); }, log: (m) => console.log(`[${name}] ${m}`) });
  c.inbox = inbox;
  c.wait = async (type, ms = 10000) => {
    const t0 = Date.now();
    for (;;) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0].payload;
      if (Date.now() - t0 > ms) throw new Error(`[${name}] esperei ${type} por ${ms} ms; chegou: ${inbox.map((m) => m.type).join(",") || "nada"}`);
      await new Promise((r) => { waiters.push(r); setTimeout(r, 100); });
    }
  };
  return c;
}
const track = { id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley", album: "Whenever You Need Somebody", duration: 213000, thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" };
const step = (m) => console.log("✔", m);

const host = make("anfitrião"), guest = make("convidado");
try {
  await Promise.all([host.connect(), guest.connect()]); step("os dois conectaram");
  host.send("create_room", { username: "MetroTesteHost" });
  const created = await host.wait("room_created");
  assert.match(created.roomCode, /^[A-Z0-9]{4,10}$/); assert.ok(created.userId && created.sessionToken);
  step(`sala criada: ${created.roomCode}`);

  guest.send("join_room", { roomCode: created.roomCode, username: "MetroTesteGuest" });
  const req = await host.wait("join_request");
  assert.equal(req.username, "MetroTesteGuest"); step("anfitrião recebeu o pedido de entrada");
  host.send("approve_join", { userId: req.userId });
  const joined = await guest.wait("join_approved");
  assert.equal(joined.roomCode, created.roomCode);
  assert.equal(joined.state.users.length >= 2, true);
  assert.equal(joined.state.hostId, created.userId);
  step(`convidado entrou (${joined.state.users.map((u) => u.username).join(", ")})`);
  const uj = await host.wait("user_joined"); assert.equal(uj.username, "MetroTesteGuest");

  host.send("playback_action", { action: "change_track", trackId: track.id, trackInfo: track, position: 0 });
  const ct = await guest.wait("sync_playback");
  assert.equal(ct.action, "change_track"); assert.equal(ct.trackInfo.id, track.id); assert.equal(ct.trackInfo.title, track.title);
  step("troca de faixa chegou ao convidado");
  host.send("playback_action", { action: "play", trackId: track.id, position: 42000, serverTime: Date.now() });
  const pl = await guest.wait("sync_playback");
  assert.equal(pl.action, "play"); assert.equal(pl.position, 42000);
  step("play com posição chegou ao convidado");
  host.send("playback_action", { action: "seek", trackId: track.id, position: 90000 });
  assert.equal((await guest.wait("sync_playback")).position, 90000); step("seek chegou");
  host.send("playback_action", { action: "pause", trackId: track.id, position: 91000 });
  assert.equal((await guest.wait("sync_playback")).action, "pause"); step("pause chegou");

  guest.send("suggest_track", { trackInfo: { ...track, id: "9bZkp7q19f0", title: "Outra faixa" } });
  const sug = await host.wait("suggestion_received");
  assert.equal(sug.fromUsername, "MetroTesteGuest"); assert.equal(sug.trackInfo.id, "9bZkp7q19f0");
  step("sugestão do convidado chegou ao anfitrião");
  host.send("approve_suggestion", { suggestionId: sug.suggestionId });
  const ap = await guest.wait("suggestion_approved");
  assert.equal(ap.trackInfo.id, "9bZkp7q19f0"); step("sugestão aprovada chegou ao convidado");

  guest.send("request_sync");
  const st = await guest.wait("sync_state"); assert.ok(st.currentTrack?.id); step(`ressincronização: faixa ${st.currentTrack.id}`);

  guest.send("ping", { clientTime: Date.now(), sequence: 1 });
  const pong = await guest.wait("pong"); assert.ok(pong.clientTime); step("ping/pong");

  // sala que não existe: o servidor responde com um erro que a tela traduz
  const lost = make("perdido"); await lost.connect();
  lost.send("join_room", { roomCode: "ZZZZZZZZ", username: "Perdido" });
  const err = await lost.wait("error"); console.log("  erro de sala inexistente:", JSON.stringify(err)); assert.ok(err.code || err.message); lost.close(); step("sala inexistente devolve erro");

  guest.send("leave_room");
  const left = await host.wait("user_left"); assert.equal(left.username, "MetroTesteGuest"); step("saída do convidado avisada ao anfitrião");
  host.send("leave_room");
  console.log("\nTUDO OK contra", url);
} catch (e) { console.error("FALHOU:", e.message); process.exitCode = 1; }
finally { host.close(); guest.close(); setTimeout(() => process.exit(process.exitCode ?? 0), 300); }
