import { camposModificados, esDetalleGeneral } from './detalle';

describe('base allowlist general sin integración SQL', () => {
  it.each(['CREADO', 'ELIMINADO', 'ARCHIVADO', 'DESARCHIVADO'])('%s exige detalle vacío', accion => {
    expect(esDetalleGeneral(accion, {})).toBe(true);
    expect(esDetalleGeneral(accion, { password: 'secreto' })).toBe(false);
  });
  it.each(['nombre', 'email', 'token', 'filename', 'url', 'comentario', 'nested'])('rechaza extra %s incluso anidado', key => {
    expect(esDetalleGeneral('EDITADO', { changedFields: ['titulo'], [key]: { token: 'privado' } })).toBe(false);
  });
  it('rechaza legacy, arrays y accesores sin ejecutarlos', () => {
    expect(esDetalleGeneral('CREADO', null)).toBe(false);
    expect(esDetalleGeneral('UPDATE', 'texto')).toBe(false);
    expect(esDetalleGeneral('CREADO', [])).toBe(false);
    const getter = jest.fn(() => ['titulo']);
    const detalle = {};
    Object.defineProperty(detalle, 'changedFields', { get: getter });
    expect(esDetalleGeneral('EDITADO', detalle)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it('acepta campos únicos sin valores ni secretos', () => {
    expect(esDetalleGeneral('EDITADO', { changedFields: ['titulo', 'descripcion'] })).toBe(true);
    for (const changedFields of [[], ['password'], ['titulo', 'titulo'], [{ titulo: 'privado' }]]) {
      expect(esDetalleGeneral('EDITADO', { changedFields })).toBe(false);
    }
  });
  it('rechaza no-op y vencida como estado editable', () => {
    expect(esDetalleGeneral('ESTADO_CAMBIADO', { estadoAnterior: 'PENDIENTE', estadoNuevo: 'HECHA' })).toBe(true);
    for (const estadoNuevo of ['HECHA', 'VENCIDA']) {
      expect(esDetalleGeneral('ESTADO_CAMBIADO', { estadoAnterior: 'HECHA', estadoNuevo })).toBe(false);
    }
  });
  it('compara fechas y conjuntos sin falsas diferencias', () => {
    expect(camposModificados({ miembros: ['a', 'b'], fechaInicio: new Date(0) }, { miembros: ['b', 'a'], fechaInicio: new Date(0) })).toEqual([]);
    expect(camposModificados({ titulo: 'antes', descripcion: null }, { titulo: 'después', descripcion: undefined })).toEqual(['titulo']);
  });
  it('no acredita referencias movimiento ni adjuntos', () => {
    expect(esDetalleGeneral('MOVIDO', { proyectoOrigenId: 'a', proyectoDestinoId: 'b' })).toBe(false);
    expect(esDetalleGeneral('ADJUNTO_LISTO', {})).toBe(false);
  });
});
