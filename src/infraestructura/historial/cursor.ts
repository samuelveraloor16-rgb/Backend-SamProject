import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
export interface CursorHistorial { v: 1; scope: string; corte: string; fecha: string; id: string }
/** AEAD: opaco y autenticado, clave solo servidor, no JWT ni credencial. */
export class CursorHistorialCodec {
  constructor(private readonly secret: string | undefined) {}
  private key() {
    if (!this.secret) throw new ServiceUnavailableException('Servicio temporalmente no disponible; reintente');
    return createHash('sha256').update(this.secret).digest();
  }
  encode(value: CursorHistorial): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  }
  decode(value: string, scope: string): CursorHistorial {
    const key = this.key();
    try {
      // Cota derivada del formato (UUID máximo36, dos fechas ISO24 y scope
      // conocido), NO fija el límite de producto propuesto 2048 pendiente.
      const size = Buffer.byteLength(JSON.stringify({ v: 1, scope, corte: '2000-01-01T00:00:00.000Z', fecha: '2000-01-01T00:00:00.000Z', id: 'f'.repeat(36) }));
      if (value.length > Math.ceil((28 + size) / 3) * 4) throw new Error();
      if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
      const b = Buffer.from(value, 'base64url');
      if (b.toString('base64url') !== value || b.length < 29) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(12, 28));
      const p = JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8')) as CursorHistorial;
      if (!p || Object.keys(p).sort().join() !== 'corte,fecha,id,scope,v' || p.v !== 1 || p.scope !== scope
        || typeof p.id !== 'string' || !p.id || p.id.length > 36 || ![p.fecha, p.corte].every(d => typeof d === 'string' && new Date(d).toISOString() === d)
        || p.fecha > p.corte) throw new Error();
      return p;
    } catch { throw new BadRequestException('Cursor inválido'); }
  }
}
