// Parceiro de teste do Ouvir junto: faz o papel do OUTRO lado enquanto o app (no navegador) faz o seu.
// Uso: node scripts/net/lt-partner.mjs host|guest <arquivo-de-estado.json> [código]
import { readFileSync, writeFileSync } from "node:fs";
import { makeCodec } from "../../src/lib/lt/protocol.ts";
import { LTClient } from "../../src/lib/lt/client.ts";
const [role, stateFile, codeArg] = process.argv.slice(2);
const codec = makeCodec(readFileSync("src/lib/lt/listentogether.proto", "utf8"));
const state = { role, events: [], room: null };
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 1));
const T = { id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley", album: "Whenever You Need Somebody", duration: 213000, thumbnail: "" };
const T2 = { id: "9bZkp7q19f0", title: "Gangnam Style", artist: "PSY", album: "", duration: 252000, thumbnail: "" };
let userId = null;
const c = new LTClient({ codec, url: "wss://metroserverx.meowery.eu/ws", onMessage: (type, p) => {
  state.events.push({ type, p: type === "join_approved" || type === "sync_state" ? { ...p, state: undefined, track: p.state?.currentTrack ?? p.currentTrack } : p }); save();
  if (type === "room_created") { state.room = p.roomCode; userId = p.userId; save(); }
  if (type === "join_request") c.send("approve_join", { userId: p.userId });
  if (type === "user_joined" && role === "host") {
    setTimeout(() => c.send("playback_action", { action: "change_track", trackId: T.id, trackInfo: T, position: 0, serverTime: Date.now() }), 1500);
    setTimeout(() => c.send("playback_action", { action: "play", trackId: T.id, position: 30000, serverTime: Date.now() }), 5000);
    setTimeout(() => c.send("playback_action", { action: "sync_queue", trackId: T.id, queue: [T2], serverTime: Date.now() }), 6500);
  }
  if (type === "suggestion_received") c.send("approve_suggestion", { suggestionId: p.suggestionId });
  if (type === "join_approved") userId = p.userId;
}, log: (m) => { state.events.push({ type: "log", m }); save(); } });
await c.connect();
if (role === "host") c.send("create_room", { username: "ParceiroHost" });
else c.send("join_room", { roomCode: codeArg, username: "ParceiroGuest" });
save();
// controles vindos do teste, por arquivo: {"send":[type,payload]}
setInterval(() => { try { const cmd = JSON.parse(readFileSync(stateFile + ".cmd", "utf8")); writeFileSync(stateFile + ".cmd", "{}"); if (cmd.send) c.send(cmd.send[0], cmd.send[1]); if (cmd.exit) { c.send("leave_room"); setTimeout(() => process.exit(0), 400); } } catch {} }, 300);
setTimeout(() => process.exit(0), 120000);
