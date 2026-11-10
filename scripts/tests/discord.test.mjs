import test from "node:test";
import assert from "node:assert/strict";
import { buildPresence, trackUrl } from "../../src/lib/discordPresence.ts";

const track = { title: "Sombra de Papel", artist: "Kaito Norte", album: "Deriva", art: "https://x/c.jpg", duration: 180, position: 30, playing: true, provider: "youtube", sourceId: "abc", format: "AAC", bitrate: "256 kbps" };
const cfg = { appId: "123", activity: "listening", useDetails: true, showProvider: false, playbackDetails: false, advanced: false, name: "", btn1: "", btn2: "", btn2Url: "" };
const NOW = 1_000_000_000;

test("tocando: título em destaque, tempos e botão Ouvir", () => {
  const p = buildPresence(track, cfg, NOW);
  assert.equal(p.details, "Sombra de Papel"); assert.equal(p.state, "Kaito Norte");
  assert.equal(p.startMs, NOW - 30_000); assert.equal(p.endMs, NOW - 30_000 + 180_000);
  assert.deepEqual(p.buttons, [["Ouvir no YouTube Music", "https://music.youtube.com/watch?v=abc"]]);
  assert.equal(p.name, "MetroMusic"); assert.equal(p.largeImage, "https://x/c.jpg"); assert.equal(p.largeText, "Deriva");
});
test("pausado: mostra o tempo e tira a barra de progresso", () => {
  const p = buildPresence({ ...track, playing: false, position: 83 }, cfg, NOW);
  assert.equal(p.state, "⏸ Pausado em 1:23 de 3:00 · Kaito Norte");
  assert.equal(p.details, "Sombra de Papel");
  assert.equal(p.startMs, undefined); assert.equal(p.endMs, undefined);
  // com o artista em destaque, o título vai no fim do estado
  assert.equal(buildPresence({ ...track, playing: false, position: 5 }, { ...cfg, useDetails: false }, NOW).state, "⏸ Pausado em 0:05 de 3:00 · Sombra de Papel");
  assert.equal(buildPresence({ ...track, playing: false, duration: 0 }, cfg, NOW).state.startsWith("⏸ Pausado em 0:30 ·"), true);
});
test("limpa sem faixa ou sem ID do aplicativo", () => {
  assert.equal(buildPresence(null, cfg), null);
  assert.equal(buildPresence(track, { ...cfg, appId: "  " }), null);
});
test("opções: artista em destaque, provedor, detalhes de reprodução", () => {
  const p = buildPresence(track, { ...cfg, useDetails: false, showProvider: true, playbackDetails: true }, NOW);
  assert.equal(p.details, "Kaito Norte"); assert.equal(p.state, "Sombra de Papel");
  assert.equal(p.largeText, "Deriva · via YouTube Music · AAC · 256 kbps");
});
test("modo avançado: nome, botões com variáveis e segundo botão só com URL", () => {
  const adv = { ...cfg, advanced: true, name: "Minha rádio", btn1: "Tocar {song_name} de {artist_name}", btn2: "Site", btn2Url: "https://exemplo.com" };
  const p = buildPresence(track, adv, NOW);
  assert.equal(p.name, "Minha rádio");
  assert.equal(p.buttons[0][0], "Tocar Sombra de Papel de Kaito Norte");
  assert.deepEqual(p.buttons[1], ["Site", "https://exemplo.com"]);
  assert.equal(buildPresence(track, { ...adv, btn2Url: "" }, NOW).buttons.length, 1);
  assert.equal(buildPresence(track, { ...adv, name: "" }, NOW).name, "MetroMusic");
});
test("capa não-https e provedores sem link", () => {
  assert.equal(buildPresence({ ...track, art: "http://x/c.jpg" }, cfg, NOW).largeImage, undefined);
  assert.equal(buildPresence({ ...track, provider: "soundcloud" }, cfg, NOW).buttons.length, 0);
  assert.equal(trackUrl("spotify", "9z"), "https://open.spotify.com/track/9z");
  assert.equal(trackUrl("youtube", "a b"), "https://music.youtube.com/watch?v=a%20b");
  assert.equal(buildPresence({ ...track, duration: 0 }, cfg, NOW).endMs, undefined);
});
