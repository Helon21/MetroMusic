// Protocolo do Ouvir junto (compatível com o servidor do MetroFuse/Metrolist): mensagens protobuf sobre WebSocket.
// O `.proto` vem de https://github.com/MetrolistGroup/metroproto e é lido em tempo de execução pelo protobufjs.
import protobuf from "protobufjs";
import { gunzipSync, gzipSync } from "fflate";

/** Tipo da mensagem → nome da mensagem protobuf do conteúdo (vazio = sem conteúdo). */
export const PAYLOAD_OF: Record<string, string> = {
  // cliente → servidor
  create_room: "CreateRoomPayload", join_room: "JoinRoomPayload", leave_room: "LeaveRoomPayload", approve_join: "ApproveJoinPayload", reject_join: "RejectJoinPayload",
  playback_action: "PlaybackActionPayload", buffer_ready: "BufferReadyPayload", kick_user: "KickUserPayload", transfer_host: "TransferHostPayload", ping: "PingPayload",
  request_sync: "", reconnect: "ReconnectPayload", suggest_track: "SuggestTrackPayload", approve_suggestion: "ApproveSuggestionPayload", reject_suggestion: "RejectSuggestionPayload",
  // servidor → cliente
  room_created: "RoomCreatedPayload", join_request: "JoinRequestPayload", join_approved: "JoinApprovedPayload", join_rejected: "JoinRejectedPayload", user_joined: "UserJoinedPayload",
  user_left: "UserLeftPayload", sync_playback: "PlaybackActionPayload", buffer_wait: "BufferWaitPayload", buffer_complete: "BufferCompletePayload", error: "ErrorPayload",
  pong: "PongPayload", host_changed: "HostChangedPayload", kicked: "KickedPayload", sync_state: "SyncStatePayload", reconnected: "ReconnectedPayload",
  user_reconnected: "UserReconnectedPayload", user_disconnected: "UserDisconnectedPayload", suggestion_received: "SuggestionReceivedPayload",
  suggestion_approved: "SuggestionApprovedPayload", suggestion_rejected: "SuggestionRejectedPayload", server_restarting: "ServerRestartingPayload", suggestion_submitted: "SuggestionSubmittedPayload",
};

export interface TrackInfoMsg { id: string; title: string; artist: string; album?: string; duration: number; thumbnail?: string; suggestedBy?: string }
export interface UserInfoMsg { userId: string; username: string; isHost: boolean; isConnected: boolean }
export interface RoomStateMsg { roomCode: string; hostId: string; users: UserInfoMsg[]; currentTrack?: TrackInfoMsg | null; isPlaying: boolean; position: number; lastUpdate: number; volume: number; queue: TrackInfoMsg[]; queueTitle?: string }

export interface Codec {
  /** `compress`: comprime o conteúdo com gzip (só vale a pena em conteúdos grandes; o servidor aceita os dois). */
  encode(type: string, payload?: Record<string, unknown>, compress?: boolean): Uint8Array;
  /** Decodifica o envelope e o conteúdo (números como `number`, campos ausentes com o valor padrão). */
  decode(data: Uint8Array): { type: string; payload: any };
}

export function makeCodec(protoText: string): Codec {
  const root = protobuf.parse(protoText, { keepCase: false }).root;
  const T = (n: string) => root.lookupType(`listentogether.${n}`);
  const env = T("Envelope");
  const opts = { longs: Number, defaults: true, arrays: true } as const;
  return {
    encode(type, payload, compress = false) {
      const name = PAYLOAD_OF[type];
      if (name === undefined) throw new Error(`mensagem desconhecida: ${type}`);
      let bytes = name && payload ? T(name).encode(T(name).fromObject(payload)).finish() : new Uint8Array();
      let compressed = false;
      if (compress && bytes.length > 100) { const z = gzipSync(bytes); if (z.length < bytes.length) { bytes = z; compressed = true; } }
      return env.encode(env.create({ type, payload: bytes, compressed })).finish();
    },
    decode(data) {
      const e = env.toObject(env.decode(data), { ...opts, bytes: Uint8Array }) as { type: string; payload: Uint8Array; compressed: boolean };
      const name = PAYLOAD_OF[e.type];
      if (!name || !e.payload?.length) return { type: e.type, payload: {} };
      // o servidor comprime (gzip) os conteúdos maiores, como o estado da sala
      const body = e.compressed ? gunzipSync(e.payload) : e.payload;
      return { type: e.type, payload: T(name).toObject(T(name).decode(body), opts) };
    },
  };
}

/** Sem imagem ou álbum, o servidor espera texto vazio, não `undefined`. */
export const clean = (s?: string | null) => (s ?? "").trim();
