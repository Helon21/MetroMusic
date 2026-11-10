import test from "node:test";
import assert from "node:assert/strict";
import { parseMusicLink, linkRoute } from "../../src/lib/links.ts";

test("reconhece links do YouTube Music e do YouTube", () => {
  assert.deepEqual(parseMusicLink("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM"), { kind: "yt-track", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseMusicLink("https://youtu.be/dQw4w9WgXcQ?t=3"), { kind: "yt-track", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseMusicLink("https://music.youtube.com/playlist?list=PLabc123XYZ"), { kind: "yt-playlist", id: "PLabc123XYZ" });
  assert.deepEqual(parseMusicLink("https://music.youtube.com/browse/MPREb_abc123"), { kind: "yt-album", id: "MPREb_abc123" });
  assert.deepEqual(parseMusicLink("https://music.youtube.com/channel/UCabcdefghijk"), { kind: "yt-artist", id: "UCabcdefghijk" });
});

test("reconhece links do Spotify, com ou sem prefixo de idioma", () => {
  assert.deepEqual(parseMusicLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x"), { kind: "sp-playlist", id: "37i9dQZF1DXcBWIGoYBM5M" });
  assert.deepEqual(parseMusicLink("https://open.spotify.com/intl-pt/album/4aawyAB9vmqN3uQ7FjRGTy"), { kind: "sp-album", id: "4aawyAB9vmqN3uQ7FjRGTy" });
  assert.deepEqual(parseMusicLink("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl"), { kind: "sp-track", id: "11dFghVXANMlKmJXsNCbNl" });
});

test("texto comum, outros sites e links malformados não são links de música", () => {
  for (const t of ["blinding lights", "", "https://example.com/watch?v=dQw4w9WgXcQ", "https://open.spotify.com/show/abc", "javascript:alert(1)", "https://music.youtube.com/watch", "https://open.spotify.com/track/../x"])
    assert.equal(parseMusicLink(t), null, t);
});

test("rotas internas", () => {
  assert.equal(linkRoute({ kind: "yt-playlist", id: "PLabc" }), "yt/playlist/VLPLabc");
  assert.equal(linkRoute({ kind: "sp-album", id: "4aawyAB9vmqN3uQ7FjRGTy" }), "yt/album/sp%3Aalbum%3A4aawyAB9vmqN3uQ7FjRGTy");
  assert.equal(linkRoute({ kind: "yt-track", id: "dQw4w9WgXcQ" }), null);
});
