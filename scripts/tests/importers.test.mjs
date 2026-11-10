import test from "node:test";
import assert from "node:assert/strict";
import { parseM3u, parseCsv, guessColumns, rowsToItems } from "../../src/lib/importers.ts";

test("M3U com EXTINF, caminhos, URLs e arquivo sem metadados", () => {
  const m3u = "﻿#EXTM3U\r\n#EXTINF:215,Kaito Norte - Sombra de Papel\r\n/home/u/musicas/sombra.flac\r\n\r\n#EXTINF:-1,Só um título\r\nhttps://exemplo.com/a.mp3\r\n/home/u/musicas/Sem Tag.mp3\r\n#EXTVLCOPT:x=1\r\nfile:///tmp/outra.m4a\r\n";
  const r = parseM3u(m3u);
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], { artist: "Kaito Norte", title: "Sombra de Papel", durationSec: 215, path: "/home/u/musicas/sombra.flac" });
  assert.deepEqual(r[1], { artist: "", title: "Só um título", durationSec: undefined, url: "https://exemplo.com/a.mp3" });
  assert.deepEqual([r[2].title, r[2].artist, r[2].path], ["Sem Tag", "", "/home/u/musicas/Sem Tag.mp3"]);
  assert.equal(r[3].path, "/tmp/outra.m4a");
  assert.deepEqual(parseM3u("# só comentário\n\n"), []);
});

test("CSV: aspas, vírgulas dentro do campo, aspas duplas, quebra de linha e separadores", () => {
  const csv = 'Track Name,Artist Name(s),Album\r\n"Hello, World","A; B",X\r\n"Ele disse ""oi""",C,"linha1\nlinha2"\r\n';
  assert.deepEqual(parseCsv(csv), [["Track Name", "Artist Name(s)", "Album"], ["Hello, World", "A; B", "X"], ['Ele disse "oi"', "C", "linha1\nlinha2"]]);
  assert.deepEqual(parseCsv("a;b;c\n1;2;3"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("﻿x,y\n\n1,2"), [["x", "y"], ["1", "2"]]); // BOM e linha vazia
});

test("colunas pelo cabeçalho (Spotify, Apple, português) e itens", () => {
  assert.deepEqual(guessColumns(["Track URI", "Track Name", "Artist Name(s)", "Album Name"]), { title: 1, artist: 2, url: 0 });
  assert.deepEqual(guessColumns(["Título", "Artista", "Álbum"]), { title: 0, artist: 1, url: -1 });
  assert.deepEqual(guessColumns(["a", "b"]), { title: -1, artist: -1, url: -1 });
  const rows = parseCsv("Música,Artista,Link\nMar Azul,Ravi; Solano,https://x/1\n,Sem título,\nÓrbita,,nao-e-url");
  const items = rowsToItems(rows, true, guessColumns(rows[0]));
  assert.deepEqual(items, [{ title: "Mar Azul", artist: "Ravi, Solano", url: "https://x/1" }, { title: "Órbita", artist: "" }]);
  assert.equal(rowsToItems(rows, false, { title: 0, artist: 1 }).length, 3); // sem cabeçalho a 1ª linha também é item; a linha sem título continua de fora
});
