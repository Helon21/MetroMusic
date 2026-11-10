import test from "node:test";
import assert from "node:assert/strict";
import { publicUrl, universalUrl, shareText, whatsappUrl, telegramUrl, mailUrl } from "../../src/lib/shareLinks.ts";

test("músicas: o endereço público de cada serviço", () => {
  assert.equal(publicUrl({ kind: "track", provider: "youtube", id: "dQw4w9WgXcQ" }), "https://music.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(publicUrl({ kind: "track", provider: "spotify", id: "11dFghVXANMlKmJXsNCbNl" }), "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl");
  assert.equal(publicUrl({ kind: "track", provider: "soundcloud", id: "1", url: "https://soundcloud.com/a/b" }), "https://soundcloud.com/a/b");
});

test("sem endereço público: arquivo local, id estranho e URL que não é https", () => {
  assert.equal(publicUrl({ kind: "track", provider: "local", id: "/home/u/a.flac" }), null);
  assert.equal(publicUrl({ kind: "track", provider: "youtube", id: "curto" }), null);
  assert.equal(publicUrl({ kind: "track", provider: "soundcloud", id: "1", url: "http://x/y" }), null);
  assert.equal(publicUrl({ kind: "track", provider: "soundcloud", id: "1", url: "javascript:alert(1)" }), null);
  assert.equal(publicUrl({ kind: "playlist", id: "playlist-minha-1" }), null);
});

test("álbuns, artistas e playlists pelo id", () => {
  assert.equal(publicUrl({ kind: "album", id: "MPREb_abc123" }), "https://music.youtube.com/browse/MPREb_abc123");
  assert.equal(publicUrl({ kind: "artist", id: "UCabcdefghijklmnopqrstuv" }), "https://music.youtube.com/channel/UCabcdefghijklmnopqrstuv");
  assert.equal(publicUrl({ kind: "playlist", id: "VLPLabc123" }), "https://music.youtube.com/playlist?list=PLabc123");
  assert.equal(publicUrl({ kind: "playlist", id: "RDCLAK5uy_x" }), "https://music.youtube.com/playlist?list=RDCLAK5uy_x");
  assert.equal(publicUrl({ kind: "playlist", id: "sp:playlist:37i9dQZF1DXcBWIGoYBM5M" }), "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
  assert.equal(publicUrl({ kind: "album", id: "sp:album:4aawyAB9vmqN3uQ7FjRGTy" }), "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy");
  assert.equal(publicUrl({ kind: "album", id: "sc:123" }), null);
});

test("link universal só para música e álbum de serviços conhecidos", () => {
  const yt = "https://music.youtube.com/watch?v=dQw4w9WgXcQ";
  assert.equal(universalUrl(yt, "track"), `https://song.link/${yt}`);
  assert.equal(universalUrl("https://open.spotify.com/album/x", "album"), "https://song.link/https://open.spotify.com/album/x");
  assert.equal(universalUrl(yt, "artist"), null);
  assert.equal(universalUrl(yt, "playlist"), null);
  assert.equal(universalUrl("https://exemplo.com/a", "track"), null);
  assert.equal(universalUrl(null, "track"), null);
});

test("atalhos dos apps de mensagem codificam o texto", () => {
  const text = shareText("Blinding Lights — The Weeknd", "https://music.youtube.com/watch?v=x&y=1");
  assert.equal(text, "Blinding Lights — The Weeknd\nhttps://music.youtube.com/watch?v=x&y=1");
  assert.ok(whatsappUrl(text).startsWith("https://wa.me/?text=") && !whatsappUrl(text).includes("\n") && whatsappUrl(text).includes("%0A"));
  assert.ok(telegramUrl("https://a/b?c=1", "T & Co").includes("url=https%3A%2F%2Fa%2Fb%3Fc%3D1&text=T%20%26%20Co"));
  assert.ok(mailUrl("Oi ç", "corpo").startsWith("mailto:?subject=Oi%20%C3%A7&body=corpo"));
});
