import { UnprocessableEntityException } from '@nestjs/common';

/** Lee únicamente cmap Unicode BMP formato 4 de la fuente fija de confianza.
 * Si el paquete cambia de formato falla cerrado, no admite fuentes del usuario.
 */
export function verificarGlifos(fuente: Buffer, texto: string): void {
  let cmap = 0;
  for (let i = 0; i < fuente.readUInt16BE(4); i++) {
    const offset = 12 + i * 16;
    if (fuente.toString('ascii', offset, offset + 4) === 'cmap') cmap = fuente.readUInt32BE(offset + 8);
  }
  if (!cmap) throw new Error('Fuente sin cmap');
  let tabla = 0;
  for (let i = 0; i < fuente.readUInt16BE(cmap + 2); i++) {
    const record = cmap + 4 + i * 8;
    const platform = fuente.readUInt16BE(record);
    const encoding = fuente.readUInt16BE(record + 2);
    const sub = cmap + fuente.readUInt32BE(record + 4);
    if ((platform === 0 || (platform === 3 && encoding === 1)) && fuente.readUInt16BE(sub) === 4) tabla = sub;
  }
  if (!tabla) throw new Error('Fuente cmap no compatible');
  const segmentos = fuente.readUInt16BE(tabla + 6) / 2;
  const ends = tabla + 14;
  const starts = ends + segmentos * 2 + 2;
  const deltas = starts + segmentos * 2;
  const ranges = deltas + segmentos * 2;
  for (const char of texto) {
    if (char === '\n' || char === '\r') continue;
    const code = char.codePointAt(0)!;
    let glyph = 0;
    if (!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(char) && code <= 0xffff) {
      for (let i = 0; i < segmentos; i++) {
        if (code < fuente.readUInt16BE(starts + i * 2) || code > fuente.readUInt16BE(ends + i * 2)) continue;
        const delta = fuente.readInt16BE(deltas + i * 2);
        const range = fuente.readUInt16BE(ranges + i * 2);
        if (range === 0) glyph = (code + delta) & 0xffff;
        else {
          const address = ranges + i * 2 + range + 2 * (code - fuente.readUInt16BE(starts + i * 2));
          const raw = fuente.readUInt16BE(address);
          glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        break;
      }
    }
    if (glyph === 0) throw new UnprocessableEntityException('Contenido no representable en PDF');
  }
}
