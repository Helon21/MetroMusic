import test from "node:test";
import assert from "node:assert/strict";
import { parseNotes, plain, fmtBytes } from "../../src/lib/releaseNotes.ts";

test("título, itens e parágrafo, sem as marcas do Markdown", () => {
  const md = "## Novidades\r\n\r\n- **Ouvir junto** com o servidor do [MetroFuse](https://x.y)\n* `Downloads` com capa e letra\n1. Item numerado\n\nTexto solto com _ênfase_.\n---\n";
  assert.deepEqual(parseNotes(md), [
    { kind: "h", text: "Novidades" },
    { kind: "li", text: "Ouvir junto com o servidor do MetroFuse" },
    { kind: "li", text: "Downloads com capa e letra" },
    { kind: "li", text: "Item numerado" },
    { kind: "p", text: "Texto solto com ênfase." },
  ]);
});

test("comentários HTML, imagens e linhas vazias somem; entrada vazia dá lista vazia", () => {
  assert.deepEqual(parseNotes("<!-- rascunho -->\n<!--\nvárias\nlinhas\n-->\n![capa](a.png)\n\n- ok"), [{ kind: "li", text: "ok" }]);
  assert.deepEqual(parseNotes(""), []);
  assert.deepEqual(parseNotes(null), []);
  assert.deepEqual(parseNotes(undefined), []);
});

test("limite de blocos e HTML solto", () => {
  const many = Array.from({ length: 100 }, (_, i) => `- item ${i}`).join("\n");
  assert.equal(parseNotes(many, 10).length, 10);
  assert.equal(plain("<b>negrito</b> e <script>x</script>"), "negrito e x");
});

test("tamanho em MB com vírgula", () => {
  assert.equal(fmtBytes(0), "0 MB");
  assert.equal(fmtBytes(5.5 * 1048576), "5,5 MB");
  assert.equal(fmtBytes(250 * 1048576), "250 MB");
});
