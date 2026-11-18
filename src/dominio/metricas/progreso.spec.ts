import { calcularProgreso, esVencida, inicioDelDia } from './progreso';

const HOY = new Date('2026-11-17T10:30:00.000Z');
const inicioHoy = inicioDelDia(HOY);

describe('esVencida (RF-15)', () => {
  it('es vencida si fechaLimite es anterior al inicio de hoy y no está HECHA', () => {
    expect(
      esVencida({ fechaLimite: new Date('2026-11-16T23:59:00.000Z'), estado: 'PENDIENTE' }, HOY),
    ).toBe(true);
  });

  it('no es vencida si no tiene fechaLimite', () => {
    expect(esVencida({ fechaLimite: null, estado: 'PENDIENTE' }, HOY)).toBe(false);
  });

  it('no es vencida si está HECHA aunque la fecha pasó', () => {
    expect(
      esVencida({ fechaLimite: new Date('2026-11-01T00:00:00.000Z'), estado: 'HECHA' }, HOY),
    ).toBe(false);
  });

  it('una tarea que vence HOY no está vencida (vence al final del día)', () => {
    expect(
      esVencida({ fechaLimite: new Date(inicioHoy.getTime() + 3600_000), estado: 'PENDIENTE' }, HOY),
    ).toBe(false);
  });
});

describe('calcularProgreso (RF-11)', () => {
  it('sin tareas contables: progreso 0 y total 0', () => {
    const r = calcularProgreso([], HOY);
    expect(r).toEqual({ total: 0, hechas: 0, pendientes: 0, enCurso: 0, vencidas: 0, progreso: 0 });
  });

  it('cuenta hechas sobre tareas simples', () => {
    const r = calcularProgreso(
      [
        { estado: 'HECHA', fechaLimite: null },
        { estado: 'HECHA', fechaLimite: null },
        { estado: 'EN_CURSO', fechaLimite: null },
        { estado: 'PENDIENTE', fechaLimite: null },
      ],
      HOY,
    );
    expect(r.total).toBe(4);
    expect(r.hechas).toBe(2);
    expect(r.enCurso).toBe(1);
    expect(r.pendientes).toBe(1);
    expect(r.progreso).toBe(50);
  });

  it('redondea a 1 decimal (ej. 1 de 3 hechas → 33.3)', () => {
    const r = calcularProgreso(
      [
        { estado: 'HECHA', fechaLimite: null },
        { estado: 'PENDIENTE', fechaLimite: null },
        { estado: 'PENDIENTE', fechaLimite: null },
      ],
      HOY,
    );
    expect(r.progreso).toBe(33.3);
  });

  it('cuenta subtareas como contables (el padre con subtareas no se incluye en la lista)', () => {
    // El repositorio entrega solo contables: 1 tarea simple + 2 subtareas del padre.
    const contables = [
      { estado: 'HECHA' as const, fechaLimite: null }, // tarea sin subtareas
      { estado: 'PENDIENTE' as const, fechaLimite: null }, // subtarea 1
      { estado: 'EN_CURSO' as const, fechaLimite: null }, // subtarea 2
    ];
    const r = calcularProgreso(contables, HOY);
    expect(r.total).toBe(3);
    expect(r.hechas).toBe(1);
    expect(r.progreso).toBeCloseTo(33.3);
  });

  it('marca vencidas entre las contables (fecha pasada y no HECHA)', () => {
    const r = calcularProgreso(
      [
        { estado: 'PENDIENTE', fechaLimite: new Date('2026-11-01T00:00:00.000Z') },
        { estado: 'HECHA', fechaLimite: new Date('2026-11-01T00:00:00.000Z') },
        { estado: 'EN_CURSO', fechaLimite: new Date('2026-12-01T00:00:00.000Z') },
      ],
      HOY,
    );
    expect(r.vencidas).toBe(1);
  });

  it('todas hechas → 100', () => {
    const r = calcularProgreso(
      [
        { estado: 'HECHA', fechaLimite: null },
        { estado: 'HECHA', fechaLimite: null },
      ],
      HOY,
    );
    expect(r.progreso).toBe(100);
  });
});
