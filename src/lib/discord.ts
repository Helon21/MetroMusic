// Mantém a atividade do Discord igual ao que está tocando. Só na janela principal (startDiscord).
import { create } from "zustand";
import { buildPresence, DEFAULT_DISCORD_APP_ID, type PresenceCfg, type PresenceInput } from "./discordPresence";
import { getTrack, albumOf, artistOf } from "./catalog";
import { invoke, isTauri } from "./native";
import { getSetting, useSettings } from "../store/settings";
import { usePlayer } from "../store/player";

/** Estado da conexão, mostrado em Configurações › Discord. */
export const useDiscord = create<{ state: "off" | "ok" | "error"; message: string }>(() => ({ state: "off", message: "" }));

export function discordCfg(): PresenceCfg {
  const g = (k: string) => getSetting(k);
  return {
    appId: String(g("discordAppId") ?? "").trim() || DEFAULT_DISCORD_APP_ID, activity: String(g("discordActivity")), useDetails: !!g("discordUseDetails"), showProvider: !!g("discordShowProvider"),
    playbackDetails: !!g("discordPlaybackDetails"), advanced: !!g("discordAdvanced"), name: String(g("discordName") ?? ""), btn1: String(g("discordBtn1") ?? ""),
    btn2: String(g("discordBtn2") ?? ""), btn2Url: String(g("discordBtn2Url") ?? ""),
  };
}

function input(): PresenceInput | null {
  const p = usePlayer.getState();
  const t = getTrack(p.queue[p.index]);
  if (!t) return null;
  return { title: t.title, artist: artistOf(t), album: albumOf(t), art: t.art, duration: t.duration, position: p.position, playing: p.playing && !p.error,
    provider: t.ext?.provider, sourceId: t.ext?.id, format: p.info?.codec ?? t.format, bitrate: p.info?.bitrate ? `${Math.round(p.info.bitrate / 1000)} kbps` : t.bitrate };
}

let lastKey = "", lastStart = 0, timer: ReturnType<typeof setTimeout> | undefined, sentAt = 0, pausedSince = 0, idleTimer: ReturnType<typeof setTimeout> | undefined;
const IDLE_CLEAR_MS = 10 * 60 * 1000; // pausado há 10 min: some do perfil

async function push(force = false) {
  if (!isTauri) return;
  if (!getSetting("discordRpc")) { if (lastKey !== "off") { lastKey = "off"; await invoke("discord_set", { presence: null }).catch(() => {}); useDiscord.setState({ state: "off", message: "" }); } return; }
  const i = input();
  let presence = buildPresence(i, discordCfg());
  // pausa longa: limpa a atividade em vez de deixá-la parada no perfil
  if (i && !i.playing) { if (!pausedSince) pausedSince = Date.now(); } else pausedSince = 0;
  clearTimeout(idleTimer);
  if (pausedSince) {
    if (Date.now() - pausedSince >= IDLE_CLEAR_MS) presence = null;
    else idleTimer = setTimeout(() => push(), IDLE_CLEAR_MS - (Date.now() - pausedSince) + 500);
  }
  // Só reenvia quando algo mudou: faixa, pausa/retomada, configuração, tempo mostrado na pausa, ou um salto na posição
  // (tocando normalmente o horário de início não muda, então a barra do Discord anda sozinha).
  const key = JSON.stringify(presence && { ...presence, startMs: 0, endMs: 0 });
  const start = presence?.startMs ?? 0;
  const jumped = !!start && !!lastStart && Math.abs(start - lastStart) > 3000;
  if (!force && key === lastKey && !jumped) return;
  lastKey = key; lastStart = start;
  sentAt = Date.now();
  try {
    await invoke("discord_set", { presence });
    useDiscord.setState(presence ? { state: "ok", message: "Atividade enviada ao Discord" } : { state: "off", message: "" });
  } catch (e) { useDiscord.setState({ state: "error", message: String(e) }); lastKey = ""; lastStart = 0; clearTimeout(timer); pending = true; timer = setTimeout(() => { pending = false; push(true); }, 8000); }
}

// O Discord aceita ~5 atualizações a cada 20 s e, acima disso, simplesmente para de responder:
// no máximo uma a cada 5 s, juntando as mudanças que acontecerem nesse intervalo.
const MIN_GAP_MS = 5000;
// Throttle, não debounce: a posição do player muda ~10 vezes por segundo, e reiniciar o timer a cada mudança
// nunca o deixaria disparar enquanto a música toca.
let pending = false;
const schedule = () => {
  if (pending) return;
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(() => { pending = false; push(); }, Math.max(600, MIN_GAP_MS - (Date.now() - sentAt)));
};

export function startDiscord() {
  if (!isTauri) return;
  usePlayer.subscribe(schedule);
  useSettings.subscribe(schedule);
  // se o Discord for aberto depois do app, tenta de novo de tempos em tempos
  setInterval(() => { if (useDiscord.getState().state === "error") push(true); }, 30000);
  schedule();
}
