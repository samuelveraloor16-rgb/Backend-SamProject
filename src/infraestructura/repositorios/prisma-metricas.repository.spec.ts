import { MetricasService } from '../../aplicacion/metricas/metricas.service';
import { calcularProgreso, inicioDelDia, type TareaContable } from '../../dominio/metricas/progreso';
import { ProyectosService } from '../../aplicacion/proyectos/proyectos.service';
import type { ProyectoRepository } from '../../dominio/puertos/proyecto.repository';
import type { EspacioRepository } from '../../dominio/puertos/espacio.repository';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMetricasRepository } from './prisma-metricas.repository';
import { PrismaProyectoRepository } from './prisma-proyecto.repository';

const ahora = new Date(2026, 10, 26, 12);
type Fila = TareaContable & { id: string; proyectoId: string; tareaPadreId: string | null };

describe('RF22 repositorio y servicio (dobles, no SQL ni concurrencia real)', () => {
  let tareas: Fila[];
  let proyectos: { id: string; nombre: string; espacioId: string; eliminadoEn: Date | null; archivado: boolean }[];
  let db: PrismaService;
  let findMany: jest.Mock;
  let findFirst: jest.Mock;
  let transaction: jest.Mock;
  let service: MetricasService;
  const fila = (id: string, estado: Fila['estado'], padre: string | null = null, proyectoId = 'p1', fechaLimite: Date | null = null): Fila => ({ id, estado, proyectoId, tareaPadreId: padre, fechaLimite });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(ahora);
    proyectos = [
      { id: 'p1', nombre: 'Proyecto uno', espacioId: 'e1', eliminadoEn: null, archivado: false },
      { id: 'p2', nombre: 'Proyecto dos', espacioId: 'e2', eliminadoEn: null, archivado: false },
      { id: 'destino', nombre: 'Destino', espacioId: 'e1', eliminadoEn: null, archivado: false },
    ];
    tareas = [];
    findFirst = jest.fn(async ({ where }) => proyectos.find(p => p.id === where.id && p.eliminadoEn === where.eliminadoEn && (
      (p.espacioId === 'e1' && ['miembro', 'admin'].includes(where.espacio.membresias.some.usuarioId)) ||
      (p.espacioId === 'e2' && where.espacio.membresias.some.usuarioId === 'otro')
    )) ?? null);
    findMany = jest.fn(async ({ where }) => {
      expect(where).toEqual({ proyectoId: expect.any(String), subtareas: { none: {} } });
      return tareas.filter(t => t.proyectoId === where.proyectoId && !tareas.some(h => h.tareaPadreId === t.id))
        .map(({ estado, fechaLimite }) => ({ estado, fechaLimite }));
    });
    const tx = { proyecto: { findFirst }, tarea: { findMany },
      $queryRaw: jest.fn(async (sql: TemplateStringsArray) => sql.join('').includes('statement_timestamp') ? [{ corte: new Date() }] : []),
      fronteraHistorialFinalizaciones: { findUnique: jest.fn(async () => ({ desde: ahora })) },
    };
    transaction = jest.fn(async (fn, options) => {
      expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
      return fn(tx);
    });
    db = { ...tx, $transaction: transaction } as unknown as PrismaService;
    service = new MetricasService(new PrismaMetricasRepository(db));
  });
  afterEach(() => jest.useRealTimers());

  it('identificación RF23 y métricas/corte salen de una sola transacción autorizada', async () => {
    const r = await service.obtenerResumenIdentificado('p1', 'miembro');
    expect(r.proyecto).toMatchObject({ id: 'p1', nombre: 'Proyecto uno' });
    expect(r.metricas).toMatchObject({ proyectoId: 'p1', calculadoEn: ahora, total: 0 });
    expect(transaction).toHaveBeenCalledTimes(1); expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('vacío, corte backend y selección única dentro de transacción', async () => {
    expect(await service.obtener('p1', 'miembro')).toEqual({ proyectoId: 'p1', calculadoEn: ahora, ...calcularProgreso([], ahora), trabajoPendiente: 0, ritmo: { disponible: false, motivo: 'COBERTURA_NO_ACREDITADA' } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'p1', eliminadoEn: null, espacio: { membresias: { some: { usuarioId: 'miembro' } } } }, select: { id: true, nombre: true } });
    expect(findMany).toHaveBeenCalledTimes(1);
  });
  it('simples/subtareas, padre excluido y RF11 wire/porcentaje sin cambios', async () => {
    tareas = [fila('padre', 'HECHA'), fila('s1', 'HECHA', 'padre'), fila('s2', 'EN_CURSO', 'padre'), fila('simple', 'PENDIENTE'), fila('ajena', 'HECHA', null, 'p2')];
    const resultado = await service.obtener('p1', 'miembro');
    expect(resultado).toMatchObject({ total: 3, hechas: 1, pendientes: 1, enCurso: 1, trabajoPendiente: 2, progreso: 33.3 });
    const adapterRF11 = new PrismaProyectoRepository(db);
    const rf11 = new ProyectosService({
      buscarPorId: async () => ({ id: 'p1', espacioId: 'e1' }),
      tareasContables: (id: string) => adapterRF11.tareasContables(id),
    } as unknown as ProyectoRepository, {
      obtenerMembresia: async () => ({ rol: 'MIEMBRO' }),
    } as unknown as EspacioRepository);
    const wire = { total: resultado.total, hechas: resultado.hechas, pendientes: resultado.pendientes, enCurso: resultado.enCurso, vencidas: resultado.vencidas, progreso: resultado.progreso };
    expect(await rf11.progreso('p1', 'miembro')).toEqual(wire);
    tareas[2]!.estado = 'HECHA';
    expect(await service.obtener('p1', 'miembro')).toMatchObject({ progreso: 66.7 });
    tareas[1]!.estado = 'PENDIENTE'; // reapertura, no depende de fechaFinalizacion
    expect(await service.obtener('p1', 'miembro')).toMatchObject({ hechas: 1, pendientes: 2, progreso: 33.3 });
  });
  it('RF15 antes/igual/después/null/hechas, no instante exacto', async () => {
    const inicio = inicioDelDia(ahora).getTime();
    tareas = [fila('a', 'PENDIENTE', null, 'p1', new Date(inicio - 1)), fila('b', 'EN_CURSO', null, 'p1', new Date(inicio - 1)),
      fila('c', 'PENDIENTE', null, 'p1', new Date(inicio)), fila('d', 'EN_CURSO', null, 'p1', new Date(inicio + 1)),
      fila('e', 'HECHA', null, 'p1', new Date(inicio - 1)), fila('f', 'PENDIENTE'), fila('g', 'PENDIENTE', null, 'p1', new Date(ahora.getTime() + 1))];
    expect(await service.obtener('p1', 'miembro')).toMatchObject({ total: 7, hechas: 1, pendientes: 4, enCurso: 2, vencidas: 2, trabajoPendiente: 6, progreso: 14.3 });
  });
  it.each(['miembro', 'admin'])('lectura archivado para %s sin exigir ProyectoMiembro', async usuario => {
    proyectos[0]!.archivado = true;
    expect(await service.obtener('p1', usuario)).toMatchObject({ total: 0 });
  });
  it.each([['p1', 'no-miembro'], ['p1', 'otro'], ['p2', 'admin'], ['inexistente', 'miembro']])('404 indistinguible %s/%s sin leer tareas', async (id, usuario) => {
    await expect(service.obtener(id, usuario)).rejects.toMatchObject({ message: 'Proyecto no encontrado', status: 404 });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('proyecto eliminado lógico/físico 404', async () => {
    proyectos[0]!.eliminadoEn = ahora;
    await expect(service.obtener('p1', 'miembro')).rejects.toMatchObject({ status: 404 });
    proyectos = [];
    await expect(service.obtener('p1', 'miembro')).rejects.toMatchObject({ status: 404 });
  });
  it('borrado última subtarea incorpora padre; movimiento cambia ambos proyectos', async () => {
    tareas = [fila('padre', 'HECHA'), fila('hijo', 'PENDIENTE', 'padre')];
    expect(await service.obtener('p1', 'miembro')).toMatchObject({ total: 1, progreso: 0 });
    tareas.pop();
    expect(await service.obtener('p1', 'miembro')).toMatchObject({ total: 1, progreso: 100 });
    tareas.push(fila('hijo', 'PENDIENTE', 'padre'));
    tareas.forEach(t => { t.proyectoId = 'destino'; });
    expect(await service.obtener('p1', 'miembro')).toMatchObject({ total: 0 });
    expect(await service.obtener('destino', 'miembro')).toMatchObject({ total: 1, progreso: 0 });
    tareas = []; // hard delete en cascada simulado
    expect(await service.obtener('destino', 'miembro')).toMatchObject({ total: 0 });
  });
  it('una referencia temporal aunque la lectura cruce medianoche', async () => {
    const antes = new Date(2026, 10, 26, 23, 59, 59);
    const fechaLimite = new Date(2026, 10, 26, 0);
    jest.setSystemTime(antes);
    const lento = new MetricasService({ leerInstantaneaVisible: async () => {
      jest.setSystemTime(new Date(2026, 10, 27, 0, 0, 1));
      return { proyecto: { id: 'p1', nombre: 'Proyecto' }, calculadoEn: antes, contables: [{ estado: 'PENDIENTE', fechaLimite }, { estado: 'EN_CURSO', fechaLimite }], historial: { desde: null, coberturaAcreditada: false, grupos: [] } };
    } });
    expect(await lento.obtener('p1', 'miembro')).toMatchObject({ calculadoEn: antes, total: 2, vencidas: 0, trabajoPendiente: 2 });
  });
});
