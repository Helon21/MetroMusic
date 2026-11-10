// Regras de horário do timer de sono automático e dos alarmes. Funções puras (sem React nem store)
// para poderem ser testadas com `node --test scripts/tests`.

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** `daily` todos os dias · `weekdays` segunda a sexta · `weekends` sábado e domingo. */
export function dayMatches(repeat: string, d: Date): boolean {
  const wd = d.getDay(); // 0 = domingo
  if (repeat === "weekdays") return wd >= 1 && wd <= 5;
  if (repeat === "weekends") return wd === 0 || wd === 6;
  return true;
}

export const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** Próxima vez em que `time` ("HH:MM") acontece depois de `now`, respeitando a repetição. */
export function nextOccurrence(time: string, now: Date, repeat = "daily"): Date | null {
  if (!validTime(time)) return null;
  const [h, m] = time.split(":").map(Number);
  for (let add = 0; add < 8; add++) {
    const d = new Date(now); d.setDate(d.getDate() + add); d.setHours(h, m, 0, 0);
    if (d.getTime() > now.getTime() && dayMatches(repeat, d)) return d;
  }
  return null;
}

/** "hoje às 07:00", "amanhã às 07:00" ou "seg 07:00"; para o texto "Próximo". */
export function describeNext(time: string, now: Date, repeat = "daily"): string {
  const d = nextOccurrence(time, now, repeat);
  if (!d) return "—";
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  if (days === 0) return `hoje às ${time}`;
  if (days === 1) return `amanhã às ${time}`;
  return `${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()]} às ${time}`;
}

export interface AlarmLike { id: number; time: string; on: boolean }

/** Alarmes que devem tocar neste minuto e ainda não tocaram hoje. `fired` guarda "dia|id|hora". */
export function dueAlarms<A extends AlarmLike>(alarms: A[], now: Date, fired: Set<string>): A[] {
  const t = hhmm(now), day = dayKey(now);
  return alarms.filter((a) => a.on && a.time === t && !fired.has(`${day}|${a.id}|${t}`));
}

/** O timer de sono automático dispara no horário, nos dias escolhidos, uma vez por minuto. */
export function sleepDue(opts: { auto: boolean; start: string; repeat: string }, now: Date, fired: Set<string>): boolean {
  if (!opts.auto || !validTime(opts.start) || hhmm(now) !== opts.start || !dayMatches(opts.repeat, now)) return false;
  return !fired.has(`${dayKey(now)}|sleep|${opts.start}`);
}
