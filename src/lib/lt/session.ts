// Sessão do Ouvir junto: liga o cliente do servidor ao player e à tela. O anfitrião transmite o que toca;
// os convidados seguem. O servidor é o do MetroFuse/Metrolist, então o `id` da faixa é o do YouTube Music.
import { create } from "zustand";
import protoText from "./listentogether.proto?raw";
import { clean, makeCodec, type RoomStateMsg, type TrackInfoMsg, type UserInfoMsg } from "./protocol";
import { LTClient, type ConnState } from "./client";
import { getTrack, registerTrack, type ExtInfo } from "../catalog";
import { getSetting, setSetting } from "../../store/settings";
import { usePlayer } from "../../store/player";
import { toast } from "../../store/ui";

export const LT_SERVERS: Record<string, string> = { meowery: "wss://metroserverx.meowery.eu/ws" };

export interface Member { id: string; name: string; host?: boolean; you?: boolean; hue: number; muted?: boolean; online?: boolean }
export interface Suggestion { id: number; sid: string; by: string; trackId: string }
interface LT {
  conn: ConnState; room: string | null; role: "host" | "guest" | null; waiting: boolean; userId: string | null; latency: number | null;
  members: Member[]; requests: Member[]; suggestions: Suggestion[]; blocked: string[]; logs: string[];
  log: (m: string) => void; connect: () => Promise<void>; disconnect: () => void;
  create: (name: string) => Promise<void>; join: (name: string, code: string) => Promise<void>; leave: () => void; cancelJoin: () => void;
  approve: (id: string) => void; reject: (id: string) => void; kick: (id: string) => void; transfer: (id: string) => void;
  block: (name: string) => void; unblock: (name: string) => void; mute: (id: string) => void;
  approveSuggestion: (sid: string) => void; rejectSuggestion: (sid: string) => void; suggest: (trackId: string) => boolean; resync: () => void;
}

const hueOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const ts = () => new Date().toLocaleTimeString("pt-BR");
const toMember = (u: UserInfoMsg, me: string | null): Member => ({ id: u.userId, name: u.username, host: u.isHost, you: u.userId === me, hue: hueOf(u.username), online: u.isConnected });

/** Faixa do app → faixa do protocolo. Só as do YouTube Music servem: é o que os outros clientes sabem tocar. */
export function toTrackInfo(e: ExtInfo, suggestedBy?: string): TrackInfoMsg | null {
  if (e.provider !== "youtube") return null;
  return { id: e.id, title: e.title, artist: e.artists.join(", "), album: clean(e.album), duration: e.durationMs ?? 0, thumbnail: clean(e.artworkUrl), suggestedBy: clean(suggestedBy) };
}
export function fromTrackInfo(t: TrackInfoMsg): ExtInfo {
  return { provider: "youtube", id: t.id, title: t.title, artists: t.artist ? t.artist.split(/,\s*/) : [], album: t.album || null, durationMs: t.duration || null, artworkUrl: t.thumbnail || null };
}

const codec = makeCodec(protoText);
let client: LTClient | null = null;
let me: { token: string | null; name: string } = { token: null, name: "" };
let hostSeq = 0, applying = false, reconnects = 0, wantRoom = false;
let lastSent = { id: "", playing: false, pos: 0, at: 0, vol: -1, queue: "" };
let bufferTimer: ReturnType<typeof setTimeout> | undefined;

function serverUrl() {
  const s = String(getSetting("ltServer") ?? "meowery");
  if (s === "custom") { const u = String(getSetting("ltCustomServer") ?? "").trim(); return /^wss?:\/\//i.test(u) ? u : ""; }
  return LT_SERVERS[s] ?? LT_SERVERS.meowery;
}
const blockedNow = (): string[] => (getSetting("ltBlockedList") as string[] | undefined) ?? [];
const isBlocked = (name: string) => blockedNow().some((b) => b.toLowerCase() === name.toLowerCase());

export const useLT = create<LT>((set, get) => {
  const send = (type: string, payload?: Record<string, unknown>) => client?.send(type, payload) ?? false;
  const reset = () => set({ room: null, role: null, waiting: false, userId: null, members: [], requests: [], suggestions: [] });
  const resetSession = () => { me.token = null; wantRoom = false; hostSeq = 0; lastSent = { id: "", playing: false, pos: 0, at: 0, vol: -1, queue: "" }; };
  const players = () => usePlayer.getState();
  const curId = () => { const p = players(); return p.queue[p.index]; };

  /** Aplica o estado da sala neste player (convidado): faixa, posição, tocando ou pausado, fila. */
  function applyRoom(state: Pick<RoomStateMsg, "currentTrack" | "isPlaying" | "position" | "queue" | "volume"> & { lastUpdate?: number }) {
    applying = true;
    try {
      const P = players();
      const lag = state.lastUpdate && state.isPlaying ? Math.max(0, Date.now() - state.lastUpdate) : 0; // o servidor informa quando o estado foi tirado
      const pos = (state.position + Math.min(lag, 5000)) / 1000;
      if (state.currentTrack?.id) {
        const t = registerTrack(fromTrackInfo(state.currentTrack));
        if (curId() !== t.id) P.play([t.id, ...(state.queue ?? []).map((q) => registerTrack(fromTrackInfo(q)).id)], 0, "Ouvir junto");
        else syncQueue(state.queue);
        const wait = () => { const s = usePlayer.getState(); if (curId() !== t.id) return; if (Math.abs(s.position - pos) > 1.5) s.seek(pos); if (s.playing !== state.isPlaying) s.toggle(); };
        setTimeout(wait, 400);
      }
      if (getSetting("ltSyncVolume") && typeof state.volume === "number" && state.volume >= 0) P.setVolume(state.volume);
    } finally { setTimeout(() => { applying = false; }, 900); }
  }
  function syncQueue(queue: TrackInfoMsg[] = []) {
    const P = players();
    const want = queue.map((q) => registerTrack(fromTrackInfo(q)).id);
    const upcoming = P.queue.slice(P.index + 1);
    if (want.join() === upcoming.join()) return;
    P.reorder([...P.queue.slice(0, P.index + 1), ...want]);
  }
  function whenLoaded(id: string) {
    clearTimeout(bufferTimer);
    const t0 = Date.now();
    const poll = () => {
      const s = usePlayer.getState();
      if (curId() === id && !s.buffering) return void send("buffer_ready", { trackId: id.replace(/^youtube:/, "") });
      if (Date.now() - t0 < 20000) bufferTimer = setTimeout(poll, 300);
    };
    poll();
  }

  function onMessage(type: string, p: any) {
    const L = get();
    switch (type) {
      case "room_created":
        me.token = p.sessionToken; wantRoom = true; reconnects = 0;
        set({ room: p.roomCode, role: "host", userId: p.userId, waiting: false, members: [{ id: p.userId, name: me.name, host: true, you: true, hue: hueOf(me.name), online: true }] });
        L.log(`Sala criada: ${p.roomCode}`); toast(`Sala criada: ${p.roomCode}`);
        broadcastNow(true);
        break;
      case "join_approved":
        me.token = p.sessionToken; wantRoom = true; reconnects = 0;
        set({ room: p.roomCode, role: "guest", userId: p.userId, waiting: false, members: (p.state.users ?? []).map((u: UserInfoMsg) => toMember(u, p.userId)) });
        L.log("Pedido aprovado pelo anfitrião"); toast("Você entrou na sala");
        applyRoom(p.state);
        break;
      case "join_rejected": set({ waiting: false }); L.log(`Pedido recusado: ${p.reason}`); toast(p.reason ? `Entrada recusada: ${p.reason}` : "O anfitrião recusou a entrada"); break;
      case "join_request": {
        if (isBlocked(p.username)) { send("reject_join", { userId: p.userId, reason: "bloqueado" }); L.log(`${p.username} (bloqueado) foi recusado`); break; }
        const m: Member = { id: p.userId, name: p.username, hue: hueOf(p.username) };
        L.log(`${p.username} pediu para entrar`);
        if (getSetting("ltAutoJoin")) { send("approve_join", { userId: p.userId }); break; }
        set((s) => ({ requests: [...s.requests.filter((r) => r.id !== m.id), m] }));
        toast(`${p.username} quer entrar na sala`, { label: "Aprovar", fn: () => get().approve(m.id) });
        break;
      }
      case "user_joined":
        set((s) => ({ requests: s.requests.filter((r) => r.id !== p.userId), members: s.members.some((m) => m.id === p.userId) ? s.members : [...s.members, { id: p.userId, name: p.username, hue: hueOf(p.username), online: true }] }));
        L.log(`${p.username} entrou na sala`); toast(`${p.username} entrou na sala`);
        if (get().role === "host") broadcastNow(true); // quem chegou precisa saber o que toca
        break;
      case "user_left": set((s) => ({ members: s.members.filter((m) => m.id !== p.userId) })); L.log(`${p.username} saiu da sala`); break;
      case "user_disconnected": set((s) => ({ members: s.members.map((m) => (m.id === p.userId ? { ...m, online: false } : m)) })); L.log(`${p.username} perdeu a conexão`); break;
      case "user_reconnected": set((s) => ({ members: s.members.map((m) => (m.id === p.userId ? { ...m, online: true } : m)) })); L.log(`${p.username} voltou`); break;
      case "host_changed":
        set((s) => ({ role: p.newHostId === s.userId ? "host" : "guest", members: s.members.map((m) => ({ ...m, host: m.id === p.newHostId })) }));
        L.log(`${p.newHostName} agora é o anfitrião`); toast(`${p.newHostName} agora é o anfitrião`);
        break;
      case "kicked": reset(); resetSession(); toast(p.reason ? `Você foi removido da sala: ${p.reason}` : "Você foi removido da sala"); L.log("Removido da sala"); break;
      case "sync_playback": if (L.role === "guest") applyPlayback(p); break;
      case "sync_state": if (L.role === "guest") applyRoom(p); break;
      case "buffer_wait": L.log(`Aguardando ${p.waitingFor?.length ?? 0} pessoa(s) carregarem a faixa`); break;
      case "buffer_complete": L.log("Todos carregaram a faixa"); if (L.role === "host") startAfterBuffer(); break;
      case "suggestion_received": {
        if (isBlocked(p.fromUsername)) { send("reject_suggestion", { suggestionId: p.suggestionId, reason: "bloqueado" }); break; }
        const t = registerTrack(fromTrackInfo(p.trackInfo));
        L.log(`${p.fromUsername} sugeriu “${t.title}”`);
        if (getSetting("ltAutoSuggest")) { send("approve_suggestion", { suggestionId: p.suggestionId }); players().addToQueue([t.id]); break; }
        set((s) => ({ suggestions: [...s.suggestions, { id: Date.now() + s.suggestions.length, sid: p.suggestionId, by: p.fromUsername, trackId: t.id }] }));
        toast(`${p.fromUsername} sugeriu ${t.title}`);
        break;
      }
      case "suggestion_approved": toast(`Sugestão aprovada: ${p.trackInfo?.title ?? ""}`); L.log("Sua sugestão foi aprovada"); break;
      case "suggestion_rejected": toast(p.reason ? `Sugestão recusada: ${p.reason}` : "Sua sugestão foi recusada"); break;
      case "reconnected": reconnects = 0; set({ room: p.roomCode, userId: p.userId, role: p.isHost ? "host" : "guest", members: (p.state.users ?? []).map((u: UserInfoMsg) => toMember(u, p.userId)) }); L.log("Reconectado à sala"); if (!p.isHost) applyRoom(p.state); break;
      case "error": L.log(`Erro do servidor: ${p.code} ${p.message}`); set({ waiting: false }); toast(describeError(p.code, p.message)); if (/token|session|reconnect/i.test(`${p.code}${p.message}`) && wantRoom) { reset(); resetSession(); } break;
      case "server_restarting": toast("O servidor vai reiniciar; a sala será retomada"); break;
      case "pong": set({ latency: client?.latency ?? null }); break;
    }
  }

  function applyPlayback(p: any) {
    applying = true;
    try {
      const P = players();
      const lag = (client?.latency ?? 0) / 2;
      switch (p.action) {
        case "change_track": if (p.trackInfo?.id) { const t = registerTrack(fromTrackInfo(p.trackInfo)); P.play([t.id], 0, "Ouvir junto"); if (usePlayer.getState().playing) usePlayer.getState().toggle(); whenLoaded(t.id); } break;
        case "play": { const pos = (p.position + lag) / 1000; if (Math.abs(P.position - pos) > 1.2) P.seek(pos); if (!P.playing) P.toggle(); break; }
        case "pause": if (P.playing) P.toggle(); if (typeof p.position === "number") P.seek(p.position / 1000); break;
        case "seek": P.seek(p.position / 1000); break;
        case "queue_add": if (p.trackInfo) { const t = registerTrack(fromTrackInfo(p.trackInfo)); p.insertNext ? P.playNext([t.id]) : P.addToQueue([t.id]); } break;
        case "queue_remove": { const i = P.queue.findIndex((id, k) => k > P.index && id === `youtube:${p.trackId}`); if (i >= 0) P.remove(i); break; }
        case "queue_clear": P.clearUpcoming(); break;
        case "sync_queue": syncQueue(p.queue); break;
        case "set_volume": if (getSetting("ltSyncVolume") && typeof p.volume === "number") P.setVolume(p.volume); break;
      }
    } finally { setTimeout(() => { applying = false; }, 900); }
  }

  const broadcastNow = (force = false) => broadcast(force);
  return {
    conn: "off", room: null, role: null, waiting: false, userId: null, latency: null, members: [], requests: [], suggestions: [], blocked: blockedNow(), logs: [],
    log: (m) => set((s) => ({ logs: [`[${ts()}] ${m}`, ...s.logs].slice(0, 120) })),
    connect: async () => { await ensureClient(set, get, onMessage); },
    disconnect: () => { get().leave(); client?.close(); client = null; set({ conn: "off" }); get().log("Desconectado"); },
    create: async (name) => { me.name = name; await ensureClient(set, get, onMessage); send("create_room", { username: name }); get().log(`Criando sala como ${name}…`); },
    join: async (name, code) => { me.name = name; set({ waiting: true }); try { await ensureClient(set, get, onMessage); } catch (e) { set({ waiting: false }); throw e; } send("join_room", { roomCode: code.toUpperCase(), username: name }); get().log(`Entrando na sala ${code}…`); },
    leave: () => { if (get().room || get().waiting) send("leave_room"); clearTimeout(bufferTimer); reset(); resetSession(); get().log("Você saiu da sala"); },
    cancelJoin: () => { send("leave_room"); set({ waiting: false }); },
    approve: (id) => { send("approve_join", { userId: id }); set((s) => ({ requests: s.requests.filter((r) => r.id !== id) })); },
    reject: (id) => { send("reject_join", { userId: id }); set((s) => ({ requests: s.requests.filter((r) => r.id !== id) })); },
    kick: (id) => { send("kick_user", { userId: id }); },
    transfer: (id) => { send("transfer_host", { newHostId: id }); },
    block: (name) => { const b = [...new Set([...blockedNow(), name])]; setSetting("ltBlockedList", b); set({ blocked: b }); const m = get().members.find((x) => x.name === name); if (m && get().role === "host") send("kick_user", { userId: m.id, reason: "bloqueado" }); toast(`${name} foi bloqueado`); },
    unblock: (name) => { const b = blockedNow().filter((x) => x !== name); setSetting("ltBlockedList", b); set({ blocked: b }); },
    mute: (id) => set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, muted: !m.muted } : m)) })),
    approveSuggestion: (sid) => { const s = get().suggestions.find((x) => x.sid === sid); if (!s) return; send("approve_suggestion", { suggestionId: sid }); players().addToQueue([s.trackId]); set((x) => ({ suggestions: x.suggestions.filter((y) => y.sid !== sid) })); scheduleQueue(); },
    rejectSuggestion: (sid) => { send("reject_suggestion", { suggestionId: sid }); set((x) => ({ suggestions: x.suggestions.filter((y) => y.sid !== sid) })); },
    suggest: (trackId) => { const ext = getTrack(trackId)?.ext; const ti = ext && toTrackInfo(ext, me.name); if (!ti) { toast("Só músicas do YouTube Music podem ser sugeridas à sala"); return false; } send("suggest_track", { trackInfo: ti }); toast("Sugestão enviada ao anfitrião"); return true; },
    resync: () => { send("request_sync"); toast("Ressincronizando com o anfitrião…"); },
  };

});

// ───────── Anfitrião: o que o player faz vira mensagem para a sala
const warned = new Set<string>();
let pendingStart: ReturnType<typeof setTimeout> | undefined, queueTimer: ReturnType<typeof setTimeout> | undefined;
const posMs = () => Math.round(usePlayer.getState().position * 1000);

function sendAction(action: string, extra: Record<string, unknown> = {}) {
  const id = usePlayer.getState().queue[usePlayer.getState().index];
  const ext = id ? getTrack(id)?.ext : undefined;
  client?.send("playback_action", { action, trackId: ext?.id ?? "", serverTime: Date.now(), position: posMs(), ...extra });
}

/** Depois de trocar a faixa, espera os convidados carregarem (ou 8 s) e então manda tocar. */
function startAfterBuffer() {
  clearTimeout(pendingStart);
  const P = usePlayer.getState();
  if (!P.playing) return;
  lastSent = { ...lastSent, playing: true, pos: P.position, at: Date.now() };
  sendAction("play");
}

function broadcast(force = false) {
  const L = useLT.getState();
  if (L.role !== "host" || applying) return;
  const P = usePlayer.getState(), id = P.queue[P.index];
  if (!id) return;
  const ti = getTrack(id)?.ext && toTrackInfo(getTrack(id)!.ext!);
  if (!ti) {
    if (!warned.has(id)) { warned.add(id); toast("Esta música não é do YouTube Music: a sala não consegue tocá-la"); }
    return;
  }
  if (force || id !== lastSent.id) {
    lastSent = { ...lastSent, id, playing: false, pos: 0, at: Date.now() };
    client?.send("playback_action", { action: "change_track", trackId: ti.id, trackInfo: ti, position: 0, serverTime: Date.now() });
    clearTimeout(pendingStart);
    pendingStart = setTimeout(startAfterBuffer, 8000);
    scheduleQueue(true);
  }
}

function broadcastQueueNow() {
  if (useLT.getState().role !== "host") return;
  const P = usePlayer.getState();
  const upcoming = P.queue.slice(P.index + 1).map((id) => getTrack(id)?.ext).filter((e): e is ExtInfo => !!e).map((e) => toTrackInfo(e)).filter((t): t is TrackInfoMsg => !!t).slice(0, 200);
  const key = upcoming.map((t) => t.id).join();
  if (key === lastSent.queue) return;
  lastSent.queue = key;
  sendAction("sync_queue", { queue: upcoming, queueTitle: P.queueTitle });
}
function scheduleQueue(now = false) { clearTimeout(queueTimer); queueTimer = setTimeout(broadcastQueueNow, now ? 600 : 400); }

usePlayer.subscribe((s, prev) => {
  if (useLT.getState().role !== "host" || applying || !client) return;
  const id = s.queue[s.index];
  if (id !== prev.queue[prev.index]) return broadcast();
  if (s.playing !== prev.playing && id === lastSent.id) {
    lastSent = { ...lastSent, playing: s.playing, pos: s.position, at: Date.now() };
    return sendAction(s.playing ? "play" : "pause");
  }
  // pulo na posição (o usuário arrastou a barra): bem além do esperado pelo relógio
  if (s.playing && lastSent.playing && id === lastSent.id) {
    const expected = lastSent.pos + (Date.now() - lastSent.at) / 1000;
    if (Math.abs(s.position - expected) > 2.5) { lastSent = { ...lastSent, pos: s.position, at: Date.now() }; sendAction("seek"); }
  }
  if (s.queue !== prev.queue || s.index !== prev.index) scheduleQueue();
  if (getSetting("ltSyncVolume") && s.volume !== prev.volume && Math.abs(s.volume - lastSent.vol) > 0.01) { lastSent.vol = s.volume; sendAction("set_volume", { volume: s.volume }); }
});

async function ensureClient(set: (p: Partial<LT>) => void, get: () => LT, onMessage: (t: string, p: any) => void) {
  if (client && client.state === "on") return;
  const url = serverUrl();
  if (!url) { toast("Informe a URL do servidor (começa com wss://)"); throw new Error("sem servidor"); }
  client = new LTClient({
    codec, url, onMessage,
    log: (m) => get().log(m),
    onState: (s, info) => {
      set({ conn: s });
      if (s === "off" && wantRoom && me.token && info) tryReconnect(set, get, onMessage);
      if (s === "error" && info) get().log(`Erro: ${info}`);
    },
  });
  try { await client.connect(); } catch (e) { toast(`Não consegui conectar ao servidor: ${String((e as Error).message ?? e)}`); throw e; }
}

/** O cliente atual (a análise de tipos perde o rastro de `client` depois de um `await`). */
const activeClient = (): LTClient | null => client;

/** Mensagens do servidor em português; o texto original vai junto quando não reconhecemos o caso. */
export function describeError(code: string, message: string): string {
  const t = `${code} ${message}`.toLowerCase();
  if (/not.?found|does not exist|no such|invalid.?room/.test(t)) return "Sala não encontrada. Confira o código.";
  if (/full/.test(t)) return "A sala está cheia.";
  if (/not.*host|only.*host|permission/.test(t)) return "Só o anfitrião pode fazer isso.";
  if (/rate|too many|slow/.test(t)) return "Muitas tentativas seguidas. Espere um pouco.";
  if (/username|name/.test(t) && /taken|exists|invalid|empty/.test(t)) return "Esse nome de usuário não pode ser usado nesta sala.";
  return `Ouvir junto: ${message || code}`;
}

function tryReconnect(set: (p: Partial<LT>) => void, get: () => LT, onMessage: (t: string, p: any) => void) {
  if (reconnects >= 6) { get().log("Desisti de reconectar"); toast("Perdi a conexão com a sala"); wantRoom = false; return; }
  const wait = Math.min(1000 * 2 ** reconnects, 15000); reconnects++;
  get().log(`Conexão perdida; tentando de novo em ${Math.round(wait / 1000)} s (${reconnects}/6)`);
  setTimeout(async () => {
    try { client = null; await ensureClient(set, get, onMessage); activeClient()?.send("reconnect", { sessionToken: me.token }); } catch { tryReconnect(set, get, onMessage); }
  }, wait);
}
