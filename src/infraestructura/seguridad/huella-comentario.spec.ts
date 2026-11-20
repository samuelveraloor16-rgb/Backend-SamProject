import { createHash, randomBytes } from 'crypto';
import { clavesComentario, nuevaHuella, verificarHuella } from './huella-comentario';

describe('huellas de comentarios', () => {
  const vieja = randomBytes(32).toString('hex');
  const nueva = randomBytes(32).toString('hex');
  beforeEach(() => {
    process.env.COMENTARIOS_HMAC_CLAVES = JSON.stringify({ vieja, nueva });
    process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA = 'vieja';
  });
  afterEach(() => { delete process.env.COMENTARIOS_HMAC_CLAVES; delete process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA; });
  it('permite rotación con clave previa y rechaza datos distintos', () => {
    const huella = nuevaHuella(clavesComentario(), 't', 'texto');
    process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA = 'nueva';
    expect(verificarHuella(huella, clavesComentario(), 't', 'texto').coincide).toBe(true);
    expect(verificarHuella(huella, clavesComentario(), 't', 'otro').coincide).toBe(false);
    process.env.COMENTARIOS_HMAC_CLAVES = JSON.stringify({ vieja: randomBytes(32).toString('hex'), nueva });
    expect(() => verificarHuella(huella, clavesComentario(), 't', 'texto')).toThrow();
    process.env.COMENTARIOS_HMAC_CLAVES = JSON.stringify({ nueva });
    expect(() => verificarHuella(huella, clavesComentario(), 't', 'texto')).toThrow();
  });
  it('verifica legacy sin generar legacy nuevo', () => {
    const legacy = createHash('sha256').update(JSON.stringify(['t', 'texto'])).digest('hex');
    expect(verificarHuella(legacy, clavesComentario(), 't', 'texto')).toEqual({ coincide: true, legacy: true });
    expect(nuevaHuella(clavesComentario(), 't', 'texto')).toMatch(/^hmac-sha256-v1:vieja:/);
  });
  it('falla cerrado si falta configuración o está mal formada', () => {
    delete process.env.COMENTARIOS_HMAC_CLAVES;
    expect(() => clavesComentario()).toThrow();
    process.env.COMENTARIOS_HMAC_CLAVES = JSON.stringify({ vieja: 'invalida' });
    expect(() => clavesComentario()).toThrow();
  });
});
