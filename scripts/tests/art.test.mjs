import test from "node:test";
import assert from "node:assert/strict";
import { sizedArt, artCandidates, ytVideoId } from "../../src/lib/art.ts";

test("Google/YouTube: troca o tamanho e preserva o resto", () => {
  assert.equal(sizedArt("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj", 1200), "https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj");
  assert.equal(sizedArt("https://lh3.googleusercontent.com/abc=w1200-h1200", 544), "https://lh3.googleusercontent.com/abc=w544-h544");
});
test("SoundCloud: 500 px ou original", () => {
  assert.equal(sizedArt("https://i1.sndcdn.com/artworks-x-t500x500.jpg", 4000), "https://i1.sndcdn.com/artworks-x-original.jpg");
  assert.equal(sizedArt("https://i1.sndcdn.com/artworks-x-original.jpg", 544), "https://i1.sndcdn.com/artworks-x-t500x500.jpg");
});
test("outras URLs e valores inválidos passam intactos", () => {
  assert.equal(sizedArt("https://i.scdn.co/image/abc123", 1200), "https://i.scdn.co/image/abc123");
  assert.equal(sizedArt("", 1200), "");
  assert.equal(sizedArt("https://x/a=w10-h10", NaN), "https://x/a=w10-h10");
});

test("avatares do Google (=s88-c-k…) ganham o tamanho pedido", () => {
  assert.equal(sizedArt("https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj", 1200), "https://yt3.ggpht.com/abc=s1200-c-k-c0x00ffffff-no-rj");
  assert.equal(sizedArt("https://lh3.googleusercontent.com/abc=s226", 544), "https://lh3.googleusercontent.com/abc=s544");
});

test("miniatura de vídeo do YouTube: tenta 1280×720 e vai caindo", () => {
  const hq = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=-oaymwEWCJADEOEBIAQqCghqEJQEGHgg6AJIWg&rs=AMzJL3ky";
  assert.equal(ytVideoId(hq), "dQw4w9WgXcQ");
  assert.deepEqual(artCandidates(hq, 1200), [
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg", "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", hq]);
  assert.equal(artCandidates(hq, 4000)[0], "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
  assert.equal(artCandidates(hq, 544)[0], "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg"); // qualidade menor: sem pedir a maior
  // sem repetir: o próprio hqdefault sem assinatura já está na lista
  const plain = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg";
  assert.equal(new Set(artCandidates(plain, 1200)).size, artCandidates(plain, 1200).length);
});

test("o que não é miniatura de vídeo continua com um endereço só", () => {
  assert.deepEqual(artCandidates("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj", 1200), ["https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj"]);
  assert.deepEqual(artCandidates("https://i.scdn.co/image/abc", 1200), ["https://i.scdn.co/image/abc"]);
  assert.equal(ytVideoId("https://i.ytimg.com/vi/curto/hqdefault.jpg"), null);
});
