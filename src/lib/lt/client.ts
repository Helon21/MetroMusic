// Cliente WebSocket do Ouvir junto: conecta, troca mensagens protobuf e mantém a conexão viva (ping a cada 25 s).
import type { Codec } from "./protocol";

export type ConnState = "off" | "connecting" | "on" | "error";

export interface ClientOpts {
  codec: Codec;
  url: string;
  /** Implementação de WebSocket (o navegador tem a sua; nos testes de Node usa-se a global). */
  WS?: typeof WebSocket;
  onMessage: (type: string, payload: any) => void;
  onState?: (s: ConnState, info?: string) => void;
  log?: (m: string) => void;
}

const PING_MS = 25_000;
const CONNECT_TIMEOUT_MS = 12_000;

export class LTClient {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private seq = 0;
  /** Latência medida no último pong, em ms. */
  latency: number | null = null;
  state: ConnState = "off";
  private o: ClientOpts;
  constructor(o: ClientOpts) { this.o = o; }

  private set(s: ConnState, info?: string) { this.state = s; this.o.onState?.(s, info); }

  connect(): Promise<void> {
    if (this.ws && this.state !== "off" && this.state !== "error") return Promise.resolve();
    const WS = this.o.WS ?? WebSocket;
    this.set("connecting");
    this.o.log?.(`Conectando a ${this.o.url}…`);
    return new Promise((resolve, reject) => {
      let settled = false;
      const t0 = Date.now();
      const fail = (m: string) => { if (settled) return; settled = true; clearTimeout(timer); this.set("error", m); try { ws.close(); } catch { /* já fechado */ } reject(new Error(m)); };
      const ws = new WS(this.o.url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      const timer = setTimeout(() => fail("tempo esgotado ao conectar"), CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        this.set("on");
        this.o.log?.(`Conectado em ${Date.now() - t0} ms`);
        this.pingTimer = setInterval(() => this.send("ping", { clientTime: Date.now(), sequence: ++this.seq }), PING_MS);
        resolve();
      };
      ws.onmessage = (e) => {
        try {
          const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : new Uint8Array(e.data as ArrayBufferLike);
          const m = this.o.codec.decode(data);
          if (m.type === "pong" && m.payload.clientTime) this.latency = Date.now() - m.payload.clientTime;
          this.o.onMessage(m.type, m.payload);
        } catch (err) { this.o.log?.(`Mensagem ilegível: ${err}`); }
      };
      ws.onerror = () => fail("não consegui conectar ao servidor");
      ws.onclose = (ev) => {
        clearInterval(this.pingTimer);
        if (!settled) return fail(`conexão recusada (${ev.code})`);
        if (this.ws === ws) { this.ws = null; if (this.state !== "off") { this.set("off", `conexão encerrada (${ev.code})`); } }
      };
    });
  }

  send(type: string, payload?: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(this.o.codec.encode(type, payload) as unknown as BufferSource);
    return true;
  }

  close() {
    clearInterval(this.pingTimer);
    const ws = this.ws; this.ws = null;
    this.set("off");
    try { ws?.close(1000, "saiu"); } catch { /* já fechado */ }
  }
}
