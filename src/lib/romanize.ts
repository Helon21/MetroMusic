// Romanização de letras: kana (Hepburn), hangul (Romanização Revisada), cirílico (russo, ucraniano, bielorrusso,
// quirguiz, sérvio, búlgaro, macedônio), devanágari (hindi) e gurmukhi (punjabi).
// Chinês (hanzi → pinyin com tons) usa uma função de leitura recebida de fora (o dicionário é grande e carrega sob demanda).
// Kanji em letras de japonês (com kana) não são convertidos: passam como estão.
// Funções puras para testar com `node --test scripts/tests`.

export type Roman = "ja" | "ko" | "zh" | "hi" | "pa" | "ru" | "uk" | "be" | "ky" | "sr" | "bg" | "mk";
/** Mesma ordem dos interruptores `romanize_0…11` das Configurações. */
export const ROMAN_ORDER: Roman[] = ["ja", "ko", "zh", "hi", "pa", "ru", "uk", "be", "ky", "sr", "bg", "mk"];
/** Todos os idiomas da lista têm conversão (o chinês depende do dicionário de pinyin carregado). */
export const ROMAN_SUPPORTED = new Set<Roman>(ROMAN_ORDER);

const ZH_PUNCT: Record<string, string> = { "，": ",", "。": ".", "！": "!", "？": "?", "、": ",", "；": ";", "：": ":" };

/** Lê hanzi e devolve o pinyin com tons (ex.: `你好` → `nǐ hǎo`). */
export type Pinyin = (text: string) => string;

// ───────── Japonês (kana → Hepburn)
const KANA: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o", か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko", さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to", な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no", は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo", や: "ya", ゆ: "yu", よ: "yo", ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo", だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo", ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po", ゔ: "vu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
};
const KANA_DIGRAPH: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho", ちゃ: "cha", ちゅ: "chu", ちょ: "cho", にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo", りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo", びゃ: "bya", びゅ: "byu", びょ: "byo", ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo", てぃ: "ti", でぃ: "di", うぃ: "wi", うぇ: "we", うぉ: "wo", ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
  しぇ: "she", じぇ: "je", ちぇ: "che",
};
const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const isKana = (c: string) => /[ぁ-ゖァ-ヶー]/.test(c);

function jaToRoman(text: string): string {
  const s = toHira(text);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!isKana(c)) { out += c; continue; }
    if (c === "ー") { const m = out.match(/[aiueo]$/); out += m ? m[0] : ""; continue; }
    if (c === "っ") { // consoante dobrada: repete a primeira consoante da próxima sílaba
      const nx = KANA_DIGRAPH[s.slice(i + 1, i + 3)] ?? KANA[s[i + 1]] ?? "";
      out += nx.startsWith("ch") ? "t" : /^[bcdfghjklmnpqrstvwxyz]/.test(nx) ? nx[0] : "";
      continue;
    }
    const two = KANA_DIGRAPH[s.slice(i, i + 2)];
    if (two) { out += two; i++; continue; }
    out += KANA[c] ?? c;
  }
  return out;
}

// ───────── Coreano (hangul → Romanização Revisada, por sílaba, sem assimilação entre sílabas)
const KO_INIT = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const KO_MED = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const KO_FIN = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
function koToRoman(text: string): string {
  return text.replace(/[가-힣]/g, (ch) => {
    const n = ch.charCodeAt(0) - 0xac00;
    return KO_INIT[Math.floor(n / 588)] + KO_MED[Math.floor((n % 588) / 28)] + KO_FIN[n % 28];
  });
}

// ───────── Cirílico
const RU: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
const CYR_OVERRIDE: Partial<Record<Roman, Record<string, string>>> = {
  uk: { г: "h", ґ: "g", е: "e", є: "ye", и: "y", і: "i", ї: "yi", й: "y", х: "kh", щ: "shch", ь: "", ъ: "", ы: "y", э: "e" },
  be: { г: "h", ґ: "g", і: "i", ў: "u", ё: "yo", ы: "y", э: "e", ь: "", ъ: "" },
  ky: { ү: "u", ң: "ng", ө: "o", ё: "yo", ы: "y", э: "e" },
  sr: { а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š" },
  bg: { ъ: "a", щ: "sht", ю: "yu", я: "ya", ь: "y", ц: "ts", ч: "ch", ш: "sh", ж: "zh", х: "h", й: "y", и: "i", ы: "y" },
  mk: { ѓ: "gj", ѕ: "dz", ј: "j", љ: "lj", њ: "nj", ќ: "kj", џ: "dj", ж: "zh", ч: "ch", ш: "sh", х: "h", ц: "c", и: "i", ъ: "", ь: "" },
};
/** Escolhe o idioma do cirílico pelas letras que só existem nele; sem pistas, russo. */
export function cyrillicLang(text: string): Roman {
  const t = text.toLowerCase();
  if (/[їєґ]/.test(t)) return "uk";
  if (/ў/.test(t)) return "be";
  if (/[ѓѕќ]/.test(t)) return "mk";
  if (/[ђћљњџ]/.test(t)) return "sr";
  if (/[үңө]/.test(t)) return "ky";
  if (/ј/.test(t)) return /[љњ]/.test(t) ? "sr" : "mk";
  return "ru";
}
function cyrToRoman(text: string, lang: Roman): string {
  const map = { ...RU, ...(CYR_OVERRIDE[lang] ?? {}) };
  return text.replace(/[Ѐ-ӿ]/g, (ch) => {
    const lower = ch.toLowerCase();
    const r = map[lower];
    if (r === undefined) return ch;
    return ch !== lower && r ? r[0].toUpperCase() + r.slice(1) : r;
  });
}

// ───────── Devanágari (hindi) e gurmukhi (punjabi): abugidas com "a" inerente, virama e matras
interface Abugida { cons: Record<string, string>; vowels: Record<string, string>; matras: Record<string, string>; virama: string; signs: Record<string, string> }
const DEVA: Abugida = {
  cons: { क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n", ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n", प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", व: "v", श: "sh", ष: "sh", स: "s", ह: "h", ड़: "r", ढ़: "rh", फ़: "f", ज़: "z", क्ष: "ksh" },
  vowels: { अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o" },
  matras: { "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o" },
  virama: "्", signs: { "ं": "n", "ँ": "n", "ः": "h", "़": "", "।": ".", "॥": "." },
};
const GURM: Abugida = {
  cons: { ਕ: "k", ਖ: "kh", ਗ: "g", ਘ: "gh", ਙ: "n", ਚ: "ch", ਛ: "chh", ਜ: "j", ਝ: "jh", ਞ: "n", ਟ: "t", ਠ: "th", ਡ: "d", ਢ: "dh", ਣ: "n", ਤ: "t", ਥ: "th", ਦ: "d", ਧ: "dh", ਨ: "n", ਪ: "p", ਫ: "ph", ਬ: "b", ਭ: "bh", ਮ: "m", ਯ: "y", ਰ: "r", ਲ: "l", ਵ: "v", ੜ: "r", ਸ਼: "sh", ਖ਼: "kh", ਗ਼: "g", ਜ਼: "z", ਫ਼: "f", ਲ਼: "l", ਸ: "s", ਹ: "h" },
  vowels: { ਅ: "a", ਆ: "aa", ਇ: "i", ਈ: "ee", ਉ: "u", ਊ: "oo", ਏ: "e", ਐ: "ai", ਓ: "o", ਔ: "au" },
  matras: { "ਾ": "aa", "ਿ": "i", "ੀ": "ee", "ੁ": "u", "ੂ": "oo", "ੇ": "e", "ੈ": "ai", "ੋ": "o", "ੌ": "au" },
  virama: "੍", signs: { "ਂ": "n", "ਁ": "n", "ੰ": "n", "ੱ": "", "਼": "" },
};
function abugidaToRoman(text: string, ab: Abugida, range: RegExp): string {
  const chars = [...text.normalize("NFC")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (!range.test(c)) { out += c; continue; }
    if (ab.vowels[c] !== undefined) { out += ab.vowels[c]; continue; }
    if (ab.cons[c] !== undefined) {
      let base = ab.cons[c];
      // consoante com nukta (ex.: ज + ़) vira a forma própria
      if (chars[i + 1] === "़" || chars[i + 1] === "਼") { const comp = ab.cons[c + chars[i + 1]]; if (comp) { base = comp; i++; } }
      const nx = chars[i + 1];
      if (nx === ab.virama) { out += base; i++; continue; }
      if (nx !== undefined && ab.matras[nx] !== undefined) { out += base + ab.matras[nx]; i++; continue; }
      // "a" inerente; some no fim da palavra (schwa deletion), como se fala
      const endOfWord = nx === undefined || !range.test(nx) || ab.signs[nx] === ".";
      out += endOfWord ? base : base + "a";
      continue;
    }
    out += ab.signs[c] ?? c;
  }
  return out;
}

const RANGES = {
  ja: /[ぁ-ゖァ-ヶー]/, ko: /[가-힣]/, cyr: /[Ѐ-ӿ]/, hi: /[ऀ-ॿ]/, pa: /[਀-੿]/,
};

/** Maiúscula na primeira letra se o original começava assim (cirílico); o resto segue a tabela. */
export function romanize(text: string, enabled: Set<Roman>, cyrLang?: Roman, pinyin?: Pinyin): string | null {
  let out = text;
  // hanzi sem kana na linha = chinês; com kana, os kanji são japoneses e ficam como estão
  if (enabled.has("zh") && pinyin && /[\u4e00-\u9fff]/.test(out) && !/[ぁ-ゖァ-ヶ]/.test(out)) out = pinyin(out).replace(/\s*([，。！？、；：])\s*/g, (_, p: string) => `${ZH_PUNCT[p]} `).replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
  if (enabled.has("ja") && RANGES.ja.test(out)) out = jaToRoman(out);
  if (enabled.has("ko") && RANGES.ko.test(out)) out = koToRoman(out);
  if (RANGES.cyr.test(out)) { const lang = cyrLang ?? cyrillicLang(out); if (enabled.has(lang)) out = cyrToRoman(out, lang); }
  if (enabled.has("hi") && RANGES.hi.test(out)) out = abugidaToRoman(out, DEVA, RANGES.hi);
  if (enabled.has("pa") && RANGES.pa.test(out)) out = abugidaToRoman(out, GURM, RANGES.pa);
  return out === text ? null : out;
}
