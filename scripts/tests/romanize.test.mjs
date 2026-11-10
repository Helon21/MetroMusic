import test from "node:test";
import assert from "node:assert/strict";
import { cyrillicLang, romanize, ROMAN_ORDER } from "../../src/lib/romanize.ts";

const all = new Set(ROMAN_ORDER);
const r = (t, set = all, l) => romanize(t, set, l);

test("japonês (kana → Hepburn)", () => {
  assert.equal(r("こんにちは"), "konnichiha");
  assert.equal(r("ありがとう"), "arigatou");
  assert.equal(r("がっこう"), "gakkou");
  assert.equal(r("きょう"), "kyou");
  assert.equal(r("カタカナ"), "katakana");
  assert.equal(r("コーヒー"), "koohii");
  assert.equal(r("しゃしん ちず つき ふじ"), "shashin chizu tsuki fuji");
  assert.equal(r("マッチ"), "matchi");
  assert.equal(r("さくら, sakura 愛"), "sakura, sakura 愛"); // latim e kanji passam
});
test("coreano (hangul → RR)", () => {
  assert.equal(r("안녕하세요"), "annyeonghaseyo");
  assert.equal(r("사랑해"), "saranghae");
  assert.equal(r("한국"), "hanguk");
  assert.equal(r("가나다 BTS"), "ganada BTS"); // latim passa
  assert.equal(r("밥"), "bap"); // final ㅂ = p (sem assimilação entre sílabas)
});
test("cirílico por idioma", () => {
  assert.equal(r("Привет"), "Privet");
  assert.equal(r("я люблю тебя"), "ya lyublyu tebya");
  assert.equal(r("Щука"), "Shchuka");
  assert.equal(r("Дякую, їжак"), "Dyakuyu, yizhak");
  assert.equal(r("љубав и ђак"), "ljubav i đak");
  assert.equal(r("къща", all, "bg"), "kashta");
  assert.equal(r("Привет", new Set(["uk"])), null); // russo desligado → não mexe
});
test("detecção do cirílico", () => {
  assert.equal(cyrillicLang("їжак"), "uk");
  assert.equal(cyrillicLang("ўзровень"), "be");
  assert.equal(cyrillicLang("ѓубре"), "mk");
  assert.equal(cyrillicLang("ђак"), "sr");
  assert.equal(cyrillicLang("көз"), "ky");
  assert.equal(cyrillicLang("привет"), "ru");
});
test("hindi e punjabi", () => {
  assert.equal(r("नमस्ते"), "namaste");
  assert.equal(r("प्यार"), "pyaar");
  assert.equal(r("ਸਤ"), "sat");
});
test("só romaniza o que está ligado; texto latino volta null", () => {
  assert.equal(r("こんにちは", new Set(["ko"])), null);
  assert.equal(r("안녕", new Set(["ja"])), null);
  assert.equal(r("hello world"), null);
  assert.equal(r("", all), null);
  assert.equal(r("안녕 こんにちは", new Set(["ko"])), "annyeong こんにちは");
});

test("chinês: hanzi viram pinyin com tons; kanji de letra japonesa não", async () => {
  const { pinyin } = await import("pinyin-pro");
  const py = (t) => pinyin(t, { toneType: "symbol", nonZh: "consecutive" });
  const zh = (t, on = ["zh", "ja"]) => romanize(t, new Set(on), undefined, py);
  assert.equal(zh("我爱你，中国"), "wǒ ài nǐ, zhōng guó"); // pontuação larga vira comum
  assert.equal(zh("你好 world 123"), "nǐ hǎo world 123");
  assert.equal(zh("夜空中最亮的星 Yeah!"), "yè kōng zhōng zuì liàng de xīng Yeah!");
  assert.equal(zh("愛してる"), "愛shiteru"); // com kana, os kanji são japoneses: ficam como estão
  assert.equal(zh("我爱你", ["ja"]), null); // chinês desligado: nada
  assert.equal(romanize("我爱你", new Set(["zh"])), null); // sem dicionário carregado: nada
});
