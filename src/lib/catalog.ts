// Catálogo simulado. Tudo aqui é fictício e gerado de forma determinística;
// o backend substitui este módulo por chamadas reais aos provedores.

export type SourceId = "youtube" | "tidal" | "spotify" | "soundcloud" | "deezer" | "jiosaavn" | "qobuz" | "offline";

/** Faixa como o backend a descreve (espelha `TrackInfo` em src-tauri/src/model.rs). */
export interface ExtInfo {
  provider: "youtube" | "soundcloud" | "deezer"; id: string; title: string; artists: string[];
  album?: string | null; durationMs?: number | null; isrc?: string | null; artworkUrl?: string | null;
  explicit?: boolean; url?: string | null; previewUrl?: string | null;
}
export interface Artist {
  id: string; name: string; hue: number; seed: number; genre: string;
  listeners: number; subscribers: number; bio: string;
}
export interface Album {
  id: string; title: string; artistId: string; year: number; hue: number; seed: number;
  kind: "Álbum" | "EP" | "Single"; trackIds: string[];
}
export interface Track {
  id: string; title: string; artistId: string; albumId: string; duration: number;
  explicit: boolean; plays: number; hue: number; seed: number; video?: boolean;
  provider: SourceId; format: string; bitrate: string; sampleRate: string; tier?: "Lossless" | "Hi-Res" | "Atmos";
  /** Faixa real vinda de um provedor (toca pelo backend). Faixas de demonstração não têm. */
  ext?: ExtInfo; art?: string;
  episode?: boolean; podcastId?: string; date?: string; local?: boolean;
}
export interface Playlist {
  id: string; title: string; description: string; owner: string; hue: number; seed: number;
  trackIds: string[]; kind: "local" | "online" | "auto" | "mix" | "community" | "editorial";
  synced?: boolean; icon?: string; updated?: number; created?: number;
}
export interface Podcast { id: string; title: string; author: string; hue: number; seed: number; description: string; episodeIds: string[] }
export interface Mood { id: string; title: string; hue: number; group: string }
export interface LyricLine { t: number; end: number; text: string; words: { t: number; end: number; w: string }[]; bg?: boolean }
export interface Lyrics { synced: boolean; provider: string; lines: LyricLine[] }

export const SOURCES: { id: SourceId; name: string; hue: number; home: boolean }[] = [
  { id: "youtube", name: "YouTube Music", hue: 25, home: true },
  { id: "tidal", name: "TIDAL", hue: 220, home: true },
  { id: "spotify", name: "Spotify", hue: 150, home: true },
  { id: "soundcloud", name: "SoundCloud", hue: 50, home: true },
  { id: "deezer", name: "Deezer", hue: 300, home: true },
  { id: "jiosaavn", name: "JioSaavn", hue: 175, home: true },
  { id: "qobuz", name: "Qobuz", hue: 250, home: false },
  { id: "offline", name: "Offline", hue: 200, home: true },
];
export const sourceName = (id: SourceId) => SOURCES.find((s) => s.id === id)?.name ?? id;

// PRNG determinístico (mulberry32)
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, arr: T[]) => arr[Math.floor(r() * arr.length)];

const ARTISTS: [string, string, number][] = [
  ["Lume Aurora", "Dream pop", 285], ["Os Satélites", "Indie rock", 20], ["Marina Vésper", "MPB", 340],
  ["Kaito Norte", "Eletrônica", 200], ["Trio Mirante", "Jazz", 45], ["Céu de Vidro", "Shoegaze", 250],
  ["Dona Maré", "Samba", 160], ["Neon Capivara", "Synthwave", 315], ["Ravi Solano", "R&B", 15],
  ["Banda Horizonte", "Rock alternativo", 100], ["Íris Quartzo", "Pop", 180], ["Vento Sul", "Folk", 75],
  ["MC Ladeira", "Rap", 0], ["Estúdio Nuvem", "Lo-fi", 225], ["Clara Tempestade", "Pop rock", 265],
  ["Pedra Lunar", "Ambient", 130],
];
const W1 = ["Noite", "Mar", "Luz", "Sombra", "Verão", "Rua", "Céu", "Vidro", "Chuva", "Farol", "Jardim", "Eco", "Trilho", "Brisa", "Cidade", "Fogo", "Madrugada", "Maré", "Neblina", "Aurora", "Silêncio", "Miragem", "Horizonte", "Poeira", "Janela"];
const W2 = ["Azul", "de Papel", "Aberta", "do Avesso", "em Câmera Lenta", "Sem Fim", "Dourada", "de Inverno", "Elétrica", "Distante", "em Mim", "do Norte", "Partida", "de Neon", "Clara", "Imensa", "que Fica", "ao Contrário", "de Domingo", "Submersa"];
const SOLO = ["Vertigem", "Órbita", "Saudade Nova", "Quase Lá", "Devagar", "Contramão", "Fôlego", "Outro Lugar", "Recomeço", "Tanto Faz", "Longe Daqui", "Só Hoje", "Deriva", "Lado B", "Interlúdio", "Fim de Tarde", "Passageiro", "Meio-Dia", "Gravidade", "Sinal Aberto", "Tudo Azul", "Voltar", "Antes do Sol", "Ponto Cego", "Carta Náutica"];

export const artists: Artist[] = [];
export const albums: Album[] = [];
export const tracks: Track[] = [];
export const playlists: Playlist[] = [];
export const podcasts: Podcast[] = [];

const FORMATS: [SourceId, string, string, string, Track["tier"]][] = [
  ["deezer", "FLAC", "1.411 kbps", "44,1 kHz / 16-bit", "Lossless"],
  ["tidal", "FLAC", "4.608 kbps", "96 kHz / 24-bit", "Hi-Res"],
  ["qobuz", "FLAC", "9.216 kbps", "192 kHz / 24-bit", "Hi-Res"],
  ["youtube", "Opus", "160 kbps", "48 kHz", undefined],
  ["spotify", "AAC", "256 kbps", "44,1 kHz", undefined],
  ["soundcloud", "AAC", "160 kbps", "44,1 kHz", undefined],
  ["tidal", "E-AC-3 JOC", "768 kbps", "48 kHz", "Atmos"],
  ["deezer", "MP3", "320 kbps", "44,1 kHz", undefined],
];

(function build() {
  const r = rng(20261109);
  const usedTitles = new Set<string>();
  const title = () => {
    for (let i = 0; i < 50; i++) {
      const t = r() < 0.4 ? pick(r, SOLO) : `${pick(r, W1)} ${pick(r, W2)}`;
      if (!usedTitles.has(t)) { usedTitles.add(t); return t; }
    }
    return `${pick(r, W1)} ${Math.floor(r() * 99)}`;
  };
  ARTISTS.forEach(([name, genre, hue], ai) => {
    const artistId = `ar${ai}`;
    const listeners = Math.floor(80_000 + r() * 9_000_000);
    artists.push({
      id: artistId, name, hue, seed: ai * 97 + 13, genre, listeners, subscribers: Math.floor(listeners * (0.2 + r() * 0.5)),
      bio: `${name} é um projeto de ${genre.toLowerCase()} que mistura texturas orgânicas e eletrônicas. Desde a estreia, lançou trabalhos elogiados pela produção detalhada e pelas apresentações ao vivo. Este texto é fictício e serve apenas para demonstrar o layout da página do artista.`,
    });
    const nAlbums = 2 + Math.floor(r() * 3);
    for (let k = 0; k < nAlbums; k++) {
      const albumId = `al${ai}_${k}`;
      const kind: Album["kind"] = k === nAlbums - 1 && r() < 0.6 ? "Single" : r() < 0.25 ? "EP" : "Álbum";
      const n = kind === "Single" ? 1 + Math.floor(r() * 2) : kind === "EP" ? 4 + Math.floor(r() * 2) : 8 + Math.floor(r() * 5);
      const ah = (hue + Math.floor(r() * 70) - 35 + 360) % 360;
      const album: Album = { id: albumId, title: title(), artistId, year: 2026 - k - Math.floor(r() * 3), hue: ah, seed: Math.floor(r() * 1e6), kind, trackIds: [] };
      for (let t = 0; t < n; t++) {
        const f = pick(r, FORMATS);
        const id = `t${tracks.length}`;
        tracks.push({
          id, title: t === 0 && kind !== "Álbum" ? album.title : title(), artistId, albumId,
          duration: 135 + Math.floor(r() * 170), explicit: r() < 0.12, plays: Math.floor(5_000 + r() * r() * 80_000_000),
          hue: ah, seed: album.seed, provider: f[0], format: f[1], bitrate: f[2], sampleRate: f[3], tier: f[4], video: r() < 0.06,
        });
        album.trackIds.push(id);
      }
      albums.push(album);
    }
  });

  const some = (n: number, filter?: (t: Track) => boolean) => {
    const pool = filter ? tracks.filter(filter) : tracks;
    const out = new Set<string>();
    while (out.size < Math.min(n, pool.length)) out.add(pick(r, pool).id);
    return [...out];
  };
  const pl = (id: string, title: string, description: string, owner: string, kind: Playlist["kind"], n: number, hue: number, extra: Partial<Playlist> = {}) =>
    playlists.push({ id, title, description, owner, kind, hue, seed: Math.floor(r() * 1e6), trackIds: some(n), updated: Date.now() - Math.floor(r() * 40) * 864e5, created: Date.now() - Math.floor(60 + r() * 300) * 864e5, ...extra });

  pl("p_estrada", "Pé na estrada", "Para viagens longas e janelas abertas.", "Você", "local", 24, 35);
  pl("p_foco", "Foco profundo", "Instrumentais para trabalhar sem distração.", "Você", "local", 31, 215);
  pl("p_treino", "Treino pesado", "Batidas para não parar.", "Você", "local", 18, 5);
  pl("p_domingo", "Domingo de manhã", "Café, sol e nada na agenda.", "Você", "local", 22, 70, { synced: true });
  pl("p_chuva", "Dias de chuva", "", "Você", "local", 15, 240);
  pl("p_festa", "Festa em casa", "A playlist colaborativa da turma.", "Você", "local", 40, 320, { synced: true });
  pl("p_vazia", "Ideias para depois", "", "Você", "local", 0, 130);

  ["Mix de descobertas", "Mix para relaxar", "Mix de energia", "Mix nostalgia", "Mix da madrugada", "Mix acústico"].forEach((t, i) =>
    pl(`mix${i}`, t, "Feito para você, atualizado todo dia.", "MetroMusic", "mix", 25, (i * 62 + 280) % 360));
  ["Novidades da semana", "Top Brasil", "Indie em alta", "Jazz para a noite", "Eletrônica essencial", "Clássicos do samba", "Lo-fi para estudar", "Pop do momento"].forEach((t, i) =>
    pl(`ed${i}`, t, "Seleção editorial.", "Editorial", "editorial", 30, (i * 47 + 10) % 360));
  ["rolê de sexta", "músicas que curam", "trilha do apocalipse zumbi", "só as tristes", "para cozinhar dançando", "viagem no tempo: 2012"].forEach((t, i) =>
    pl(`cm${i}`, t, "Playlist da comunidade.", ["ana.b", "joaovitor", "luiza_m", "pedroh", "bia", "tiago"][i], "community", 20 + i * 3, (i * 83 + 150) % 360));
  ARTISTS.slice(0, 6).forEach(([name, , hue], i) =>
    playlists.push({ id: `radio${i}`, title: `Rádio ${name}`, description: `Músicas parecidas com ${name}.`, owner: "MetroMusic", kind: "mix", hue, seed: i * 311 + 5, trackIds: some(25) }));

  const PODS: [string, string, number][] = [["Faixa a Faixa", "Rádio Mirante", 30], ["Ouvido Absoluto", "Estúdio Nuvem", 260], ["B-Side", "Coletivo Agulha", 190], ["Som & Fúria", "Canal Vinil", 350]];
  const EP = ["A história por trás do disco", "Como nasce um refrão", "Entrevista: produzindo em casa", "Os melhores lançamentos do mês", "O som dos anos 90", "Ao vivo é melhor?", "Samples que você não percebeu", "Guia para começar no vinil"];
  PODS.forEach(([t, author, hue], pi) => {
    const pod: Podcast = { id: `pod${pi}`, title: t, author, hue, seed: pi * 733 + 9, description: `${t} é um podcast semanal sobre música, bastidores e descobertas. Conteúdo fictício para demonstração.`, episodeIds: [] };
    for (let e = 0; e < 8; e++) {
      const id = `ep${pi}_${e}`;
      tracks.push({ id, title: `#${48 - e} — ${EP[(e + pi) % EP.length]}`, artistId: "ar0", albumId: "", duration: 1500 + Math.floor(r() * 2400), explicit: false, plays: Math.floor(r() * 90000), hue, seed: pod.seed, provider: "youtube", format: "Opus", bitrate: "96 kbps", sampleRate: "48 kHz", episode: true, podcastId: pod.id, date: `${1 + ((e * 7) % 28)} de ${["out", "set", "ago"][Math.floor(e / 3)]}.` });
      pod.episodeIds.push(id);
    }
    podcasts.push(pod);
  });
})();

export const moods: Mood[] = [
  ...["Relaxar", "Foco", "Treino", "Festa", "Dormir", "Romance", "Triste", "Energia", "Viagem", "Para dirigir"].map((title, i) => ({ id: `m${i}`, title, hue: (i * 36 + 20) % 360, group: "Climas e momentos" })),
  ...["Pop", "Rock", "MPB", "Samba e pagode", "Sertanejo", "Funk", "Rap e trap", "Eletrônica", "Jazz", "Clássica", "Indie", "Metal", "Reggae", "K-pop", "Lo-fi", "Gospel"].map((title, i) => ({ id: `g${i}`, title, hue: (i * 23 + 200) % 360, group: "Gêneros" })),
];

const byId = <T extends { id: string }>(list: T[]) => { const m = new Map<string, T>(); list.forEach((x) => m.set(x.id, x)); return m; };
const A = byId(artists), AL = byId(albums), T = byId(tracks), P = byId(playlists), PO = byId(podcasts);
export const getArtist = (id: string) => A.get(id);
export const getAlbum = (id: string) => AL.get(id);
export const getTrack = (id: string) => T.get(id);
export const getPlaylist = (id: string) => P.get(id);
export const getPodcast = (id: string) => PO.get(id);
export const getTracks = (ids: string[]) => ids.map((id) => T.get(id)).filter(Boolean) as Track[];
export const songs = tracks.filter((t) => !t.episode);
export const artistOf = (t: Track) => (t.episode ? getPodcast(t.podcastId!)?.author : A.get(t.artistId)?.name) ?? "Desconhecido";
export const albumOf = (t: Track) => (t.episode ? getPodcast(t.podcastId!)?.title : AL.get(t.albumId)?.title) ?? "";
export const artistAlbums = (id: string) => albums.filter((a) => a.artistId === id).sort((a, b) => b.year - a.year);
export const artistTracks = (id: string) => songs.filter((t) => t.artistId === id).sort((a, b) => b.plays - a.plays);

/** Embaralha de forma estável a partir de uma semente (para seções de recomendação). */
export function sample<X>(list: X[], n: number, seed: number): X[] {
  const r = rng(seed); const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy.slice(0, n);
}

const LINES = [
  "Acordei com a cidade ainda dormindo", "O céu pintou de laranja a minha janela", "Guardei teu nome num bolso do casaco",
  "E a rua inteira parecia me esperar", "Se o tempo corre, eu corro junto", "Deixa a maré levar o que pesar",
  "Tem um farol aceso no meu peito", "Que não se apaga quando o dia vem", "Eu sigo leve, eu sigo longe",
  "Contando estrelas pelo retrovisor", "A gente ri do que não deu certo", "E dança mesmo sem saber dançar",
  "Me diz que a noite ainda é uma criança", "Que o mundo cabe dentro de um refrão", "Fecho os olhos e ainda vejo luz",
  "Feito poeira em câmera lenta", "Nada é tão longe quanto parece", "Quando a canção encontra o seu lugar",
  "Eu volto sempre pro mesmo começo", "E o começo sempre volta diferente", "Sopra o vento sul na minha direção",
  "Leva o medo, traz a calmaria", "Um passo, depois outro, e a estrada abre", "Ninguém precisa entender agora",
  "Só fica um pouco, só mais um instante", "Enquanto o disco gira devagar",
];
const BG = ["(ainda vejo luz)", "(devagar)", "(sempre volta)", "(ô, ô, ô)"];

const lyricsCache = new Map<string, Lyrics | null>();
/** Letra sincronizada fictícia. `null` = letra não encontrada. */
export function getLyrics(track: Track): Lyrics | null {
  if (lyricsCache.has(track.id)) return lyricsCache.get(track.id)!;
  const n = Number(track.id.replace(/\D/g, "")) || 1;
  let out: Lyrics | null = null;
  if (!track.episode && n % 11 !== 7) {
    const r = rng(n * 7919 + 3);
    const lines: LyricLine[] = [];
    let t = 6 + r() * 5;
    const provider = pick(r, ["BetterLyrics", "LrcLib", "Apple Music", "Musixmatch", "Deezer", "KuGou"]);
    while (t < track.duration - 14) {
      const bg = r() < 0.12;
      const text = bg ? pick(r, BG) : pick(r, LINES);
      const dur = 2.6 + r() * 2.4;
      const ws = text.split(" ");
      const total = ws.reduce((s, w) => s + w.length + 1, 0);
      let wt = t;
      const words = ws.map((w) => { const d = (dur * (w.length + 1)) / total; const o = { t: wt, end: wt + d, w }; wt += d; return o; });
      lines.push({ t, end: t + dur, text, words, bg });
      t += dur + (r() < 0.1 ? 7 + r() * 6 : 0.25 + r() * 0.6);
    }
    out = { synced: n % 9 !== 4, provider, lines };
  }
  lyricsCache.set(track.id, out);
  return out;
}

const LINES_EN = [
  "I woke up while the city was still asleep", "The sky painted my window orange", "I kept your name in a coat pocket",
  "And the whole street seemed to wait for me", "If time runs, I run along", "Let the tide take whatever weighs",
  "There's a lighthouse lit inside my chest", "That doesn't go out when the day comes", "I go on light, I go on far",
  "Counting stars in the rear-view mirror", "We laugh at what went wrong", "And dance without knowing how",
  "Tell me the night is still young", "That the world fits inside a chorus", "I close my eyes and still see light",
  "Like dust in slow motion", "Nothing is as far as it seems", "When the song finds its place",
  "I always return to the same beginning", "And the beginning always returns different", "The south wind blows my way",
  "Takes the fear, brings the calm", "One step, then another, and the road opens", "Nobody needs to understand now",
  "Just stay a little, just one more moment", "While the record spins slowly",
];
const BG_EN = ["(still see light)", "(slowly)", "(always returns)", "(oh, oh, oh)"];
/** Tradução simulada usada pela "tradução por IA". */
export function translateLine(text: string) {
  const i = LINES.indexOf(text);
  if (i >= 0) return LINES_EN[i];
  const b = BG.indexOf(text);
  return b >= 0 ? BG_EN[b] : text;
}

// ───────── Faixas reais (provedores)
// Entram no mesmo catálogo das de demonstração, para menus, filas e listas funcionarem igual.
const EXT_KEY = "metromusic-ext-tracks-v1";
const EXT_MAX = 1500;
const extOrder: string[] = [];
let extTimer: ReturnType<typeof setTimeout> | undefined;

function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

function saveExt() {
  clearTimeout(extTimer);
  extTimer = setTimeout(() => {
    try { localStorage.setItem(EXT_KEY, JSON.stringify(extOrder.map((id) => T.get(id)?.ext).filter(Boolean))); } catch { /* sem armazenamento */ }
  }, 400);
}

/** Registra (ou atualiza) uma faixa real e devolve a `Track` correspondente. */
export function registerTrack(info: ExtInfo, persist = true): Track {
  const id = `${info.provider}:${info.id}`;
  const h = hashStr(id);
  const artistName = info.artists.join(", ") || "Artista desconhecido";
  const artistId = `ext:${hashStr(info.provider + artistName.toLowerCase())}`;
  if (!A.has(artistId)) A.set(artistId, { id: artistId, name: artistName, hue: h % 360, seed: h % 1e6, genre: "", listeners: 0, subscribers: 0, bio: "" });
  let albumId = "";
  if (info.album) {
    albumId = `extal:${hashStr(info.provider + artistName + info.album)}`;
    const al = AL.get(albumId);
    if (al) { if (!al.trackIds.includes(id)) al.trackIds.push(id); }
    else AL.set(albumId, { id: albumId, title: info.album, artistId, year: new Date().getFullYear(), hue: h % 360, seed: h % 1e6, kind: "Single", trackIds: [id] });
  }
  const prev = T.get(id);
  const t: Track = {
    id, title: info.title, artistId, albumId, duration: Math.round((info.durationMs ?? 0) / 1000), explicit: !!info.explicit, plays: 0,
    hue: h % 360, seed: h % 1e6, provider: info.provider, format: "—", bitrate: "—", sampleRate: "—", ext: info, art: info.artworkUrl ?? undefined,
  };
  if (prev) Object.assign(prev, t); else T.set(id, t);
  const track = T.get(id)!;
  if (!extOrder.includes(id)) { extOrder.push(id); if (extOrder.length > EXT_MAX) extOrder.shift(); }
  if (persist) saveExt();
  return track;
}

/** Recarrega as faixas reais guardadas, antes de a interface montar. */
export function loadExternalTracks() {
  try {
    const raw = localStorage.getItem(EXT_KEY);
    if (raw) (JSON.parse(raw) as ExtInfo[]).forEach((i) => registerTrack(i, false));
  } catch { /* dados antigos ou corrompidos: começa vazio */ }
}
