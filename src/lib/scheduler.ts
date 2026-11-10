// Dispara os alarmes e o timer de sono automático. Só roda na janela principal (que fica viva na bandeja).
import { dayKey, dueAlarms, sleepDue } from "./schedule";
import { resolvePlaylist } from "../store/library";
import { usePlayer } from "../store/player";
import { getSetting } from "../store/settings";
import { toast } from "../store/ui";

const fired = new Set<string>();

export function checkSchedule(now = new Date()) {
  const P = usePlayer.getState();
  for (const a of dueAlarms(getSetting<any[]>("alarms") ?? [], now, fired)) {
    fired.add(`${dayKey(now)}|${a.id}|${a.time}`);
    const pl = resolvePlaylist(a.playlist);
    if (!pl?.trackIds.length) { toast(`Alarme ${a.time}: a playlist está vazia`); continue; }
    P.play(pl.trackIds, 0, pl.title, { shuffle: !!a.random });
    toast(`Alarme ${a.time}: tocando "${pl.title}"`);
  }
  const sleep = { auto: !!getSetting("sleepAuto"), start: String(getSetting("sleepStart") ?? ""), repeat: String(getSetting("sleepRepeat") ?? "daily") };
  if (sleepDue(sleep, now, fired)) {
    fired.add(`${dayKey(now)}|sleep|${sleep.start}`);
    P.setSleep({ endsAt: now.getTime() + Number(getSetting("sleepDefault")) * 60000 });
    toast(`Timer de sono automático: ${getSetting("sleepDefault")} minutos`);
  }
  if (fired.size > 200) fired.clear();
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startScheduler() { if (!timer) timer = setInterval(() => checkSchedule(), 15000); }
