import test from "node:test";
import assert from "node:assert/strict";
import { dayMatches, describeNext, dueAlarms, nextOccurrence, sleepDue, validTime } from "../../src/lib/schedule.ts";

const at = (iso) => new Date(iso); // horário local
// 2026-11-09 é segunda-feira
test("dias da semana", () => {
  assert.ok(dayMatches("weekdays", at("2026-11-09T10:00:00")));
  assert.ok(!dayMatches("weekdays", at("2026-11-08T10:00:00"))); // domingo
  assert.ok(dayMatches("weekends", at("2026-11-14T10:00:00"))); // sábado
  assert.ok(dayMatches("daily", at("2026-11-11T10:00:00")));
});
test("validação de horário", () => {
  assert.ok(validTime("07:00") && validTime("23:59"));
  assert.ok(!validTime("24:00") && !validTime("7:00") && !validTime("ab"));
});
test("próxima ocorrência: hoje, amanhã e pulando o fim de semana", () => {
  assert.equal(describeNext("11:00", at("2026-11-09T10:00:00")), "hoje às 11:00");
  assert.equal(describeNext("09:00", at("2026-11-09T10:00:00")), "amanhã às 09:00");
  const n = nextOccurrence("07:00", at("2026-11-13T08:00:00"), "weekdays"); // sexta depois das 7h
  assert.equal(n.getDay(), 1); // segunda
  assert.equal(nextOccurrence("xx", new Date()), null);
});
test("alarme dispara uma vez por dia", () => {
  const alarms = [{ id: 1, time: "07:00", on: true }, { id: 2, time: "07:00", on: false }, { id: 3, time: "08:00", on: true }];
  const fired = new Set();
  const now = at("2026-11-09T07:00:20");
  assert.deepEqual(dueAlarms(alarms, now, fired).map((a) => a.id), [1]);
  fired.add("2026-11-09|1|07:00");
  assert.deepEqual(dueAlarms(alarms, now, fired), []);
  assert.deepEqual(dueAlarms(alarms, at("2026-11-10T07:00:05"), fired).map((a) => a.id), [1]); // no dia seguinte volta
});
test("timer de sono automático", () => {
  const o = { auto: true, start: "23:00", repeat: "weekdays" };
  const fired = new Set();
  assert.ok(sleepDue(o, at("2026-11-09T23:00:10"), fired));
  assert.ok(!sleepDue(o, at("2026-11-08T23:00:10"), fired)); // domingo
  assert.ok(!sleepDue({ ...o, auto: false }, at("2026-11-09T23:00:10"), fired));
  assert.ok(!sleepDue(o, at("2026-11-09T22:59:59"), fired));
  fired.add("2026-11-09|sleep|23:00");
  assert.ok(!sleepDue(o, at("2026-11-09T23:00:40"), fired));
});
