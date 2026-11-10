// Bitrate ao vivo: o motor mede o que foi lido do arquivo; em codecs de taxa variável o rótulo acompanha.

export interface RateInfo { codec: string; bitrate: number }

/** Codecs de taxa variável, em que o bitrate muda durante a faixa. */
const VARIABLE_RATE = /^(flac|vorbis|mp3|alac)$/i;

/** Novo `info` quando o bitrate medido (bits/s) difere o bastante do mostrado; `null` = deixa como está (evita redesenhar à toa). */
export function liveBitrate<T extends RateInfo>(info: T | null, measured: number | undefined, on: boolean): T | null {
  if (!on || !info || !measured || measured <= 0 || !VARIABLE_RATE.test(info.codec)) return null;
  if (Math.abs(measured - info.bitrate) / Math.max(1, info.bitrate) < 0.03) return null;
  return { ...info, bitrate: measured };
}
