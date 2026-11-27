import { resolverTransicion } from './historial-finalizaciones';
import type { EstadoTarea } from '../puertos/tarea.repository';

describe('RF22 resolverTransicion (reglas puras, sin reloj ni BD)', () => {
  it.each([
    ['PENDIENTE', 'HECHA', 'FINALIZADA', 'ESTABLECER'],
    ['EN_CURSO', 'HECHA', 'FINALIZADA', 'ESTABLECER'],
    ['HECHA', 'PENDIENTE', 'REABIERTA', 'LIMPIAR'],
    ['HECHA', 'EN_CURSO', 'REABIERTA', 'LIMPIAR'],
  ] as const)(
    '%s → %s genera %s y fecha %s',
    (anterior, nuevo, tipo, fecha) => {
      expect(resolverTransicion(anterior, nuevo)).toEqual({ tipo, fechaFinalizacion: fecha });
    },
  );

  it.each([
    ['HECHA', 'HECHA'],
    ['PENDIENTE', 'PENDIENTE'],
    ['EN_CURSO', 'EN_CURSO'],
    ['PENDIENTE', 'EN_CURSO'],
    ['EN_CURSO', 'PENDIENTE'],
  ] as const)('%s → %s no genera evento ni toca fechaFinalizacion', (anterior, nuevo) => {
    expect(resolverTransicion(anterior, nuevo)).toEqual({
      tipo: null,
      fechaFinalizacion: 'NO_TOCAR',
    });
  });

  it('HECHA repetida no se confunde con una nueva finalización', () => {
    const efecto = resolverTransicion('HECHA' as EstadoTarea, 'HECHA' as EstadoTarea);
    expect(efecto.tipo).toBeNull();
    expect(efecto.fechaFinalizacion).toBe('NO_TOCAR');
  });
});
