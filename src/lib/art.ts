// Ajusta a URL da capa à "Qualidade das capas". Só mexe em padrões conhecidos; qualquer outra URL passa intacta.

/** `px` = 544 | 1200 | 2000 | 4000. */
export function sizedArt(src: string, px: number): string {
  if (!src || !Number.isFinite(px)) return src;
  // YouTube Music / Google: ...=w544-h544-l90-rj  (o servidor aceita tamanhos maiores)
  const g = src.replace(/=w\d+-h\d+/, `=w${px}-h${px}`);
  if (g !== src) return g;
  // avatares e fotos de canal (yt3.ggpht.com / lh3): ...=s88-c-k-c0x00ffffff-no-rj
  const sq = src.replace(/=s\d+(?=(-|$))/, `=s${px}`);
  if (sq !== src) return sq;
  // SoundCloud: -large (100px), -t500x500 e -original
  if (/-(large|t500x500|t300x300|crop|original)\.(jpg|png)/.test(src)) return src.replace(/-(large|t500x500|t300x300|crop|original)\./, px >= 1200 ? "-original." : "-t500x500.");
  return src;
}

/** `https://i.ytimg.com/vi/<id>/<nome>.jpg` (miniatura de vídeo do YouTube) → id; `null` se for outra coisa. */
export function ytVideoId(src: string): string | null {
  const m = /^https?:\/\/(?:i\d?\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([\w-]{11})\/[\w]+\.(?:jpg|webp)/i.exec(src);
  return m ? m[1] : null;
}

/**
 * Endereços a tentar para uma capa, do melhor para o pior. Miniaturas de vídeo do YouTube têm até 1280×720
 * (`maxresdefault`), mas nem todo vídeo tem essa versão: se falhar, cai para `sddefault` (640×480), `hqdefault` (480×360)
 * e por fim o endereço original. Os parâmetros assinados (`?sqp=…`) são descartados: a imagem pública não precisa deles.
 */
export function artCandidates(src: string, px: number): string[] {
  const sized = sizedArt(src, px);
  const id = ytVideoId(src);
  if (!id || !Number.isFinite(px)) return [sized];
  const u = (n: string) => `https://i.ytimg.com/vi/${id}/${n}.jpg`;
  const ladder = px >= 1000 ? [u("maxresdefault"), u("sddefault"), u("hqdefault")] : px >= 500 ? [u("sddefault"), u("hqdefault")] : [u("hqdefault")];
  return [...new Set([...ladder, src])];
}
