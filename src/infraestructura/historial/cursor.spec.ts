import { CursorHistorialCodec } from './cursor';
describe('cursor autenticado opaco', () => {
  const codec = new CursorHistorialCodec('testkey-only-offline');
  const data = { v: 1 as const, scope: '["TAREA","t","e","u",20]', corte: '2026-11-27T12:00:00.000Z', fecha: '2026-11-27T11:00:00.000Z', id: 'a' };
  it('roundtrip, aleatoriedad y ninguna identidad en claro', () => {
    const cursor = codec.encode(data);
    expect(codec.decode(cursor, data.scope)).toEqual(data);
    expect(codec.encode(data)).not.toBe(cursor);
    expect(Buffer.from(cursor, 'base64url').toString()).not.toContain(data.scope);
  });
  it('rechaza manipulado, malformado, otra versión/clave/scope y fechas', () => {
    const cursor = codec.encode(data);
    for (const value of ['', '%%', cursor.slice(1), 'a'.repeat(100000), codec.encode({ ...data, v: 2 as 1 }), codec.encode({ ...data, fecha: 'x' })]) {
      expect(() => codec.decode(value, data.scope)).toThrow('Cursor inválido');
    }
    expect(() => codec.decode(cursor, 'otro usuario o límite')).toThrow('Cursor inválido');
    expect(() => new CursorHistorialCodec('otra-testkey').decode(cursor, data.scope)).toThrow('Cursor inválido');
  });
  it('falla cerrado sin configuración servidor', () => {
    expect(() => new CursorHistorialCodec(undefined).encode(data)).toThrow('Servicio temporalmente no disponible');
    expect(() => new CursorHistorialCodec(undefined).decode('x', data.scope)).toThrow('Servicio temporalmente no disponible');
  });
});
