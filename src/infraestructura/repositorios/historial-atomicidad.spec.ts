/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaService } from '../prisma/prisma.service';
import { PrismaProyectoRepository } from './prisma-proyecto.repository';
import { PrismaTareaRepository } from './prisma-tarea.repository';
import { PrismaUsuarioRepository } from './prisma-usuario.repository';
import { PrismaEspacioRepository } from './prisma-espacio.repository';

/** Modelo de rollback por copia de estado, NO intérprete SQL ni prueba de locks.
 * El dispatcher distingue consultas por intención, nunca respuestas FIFO.
 * Todo acceso de negocio debe pasar por el cliente de ESTA transacción. */
function preparar() {
  const fecha = new Date('2026-11-27T12:00:00Z');
  const proyecto = (id: string) => ({ id, espacioId: 'e', nombre: 'privado', descripcion: null, fechaInicio: null, fechaFin: null, archivado: false, esBandejaDeEntrada: false, miembros: [{ usuarioId: 'u', usuario: { id: 'u' } }], creadoEn: fecha, actualizadoEn: fecha, eliminadoEn: null });
  const tarea = (id: string, padre: string | null = null) => ({ id, titulo: 'privado', descripcion: null, estado: 'PENDIENTE', prioridad: 'MEDIA', fechaLimite: null, fechaFinalizacion: null, proyectoId: 'p', tareaPadreId: padre, responsableId: null, etiquetas: [], responsable: null, creadoEn: fecha, actualizadoEn: fecha });
  let state: any = { proyectos: [proyecto('p'), proyecto('q')], tareas: [tarea('t'), tarea('h', 't')], logs: [], dedicados: [], usuarios: [], espacios: [] };
  let fallo = false; let falloDedicado = false; let miembro = true; let rol = 'ADMINISTRADOR';
  let contador = 0;
  const snapshot = () => structuredClone(state);
  const completa = (row: any) => row ? ({ ...row, _count: { subtareas: state.tareas.filter((t: any) => t.tareaPadreId === row.id).length } }) : null;
  const query = jest.fn(async (sql: TemplateStringsArray, ...v: any[]) => {
    const s = sql.join('?');
    if (s.includes('pg_advisory')) return [];
    if (s.includes('clock_timestamp')) return [{ ahora: fecha }];
    if (s.includes('FROM "proyectos"')) return structuredClone(state.proyectos.filter((p: any) => p.id === v[0]));
    if (s.includes('FROM "membresias"')) return miembro ? (Array.isArray(v[1]) ? v[1] : [v[1]]).map((usuarioId: string) => ({ usuarioId, rol })) : [];
    if (s.includes('FROM "usuarios"')) return [{ id: v[0] }];
    if (s.includes('FROM "espacios_de_trabajo"')) return [{ id: v[0] }];
    if (s.includes('FROM "tareas"')) return structuredClone(state.tareas.filter((t: any) => s.includes('WHERE "tareaPadreId"') ? t.tareaPadreId === v[0] : s.includes('WHERE "proyectoId"') ? t.proyectoId === v[0] : t.id === v[0]));
    throw new Error(`Consulta no modelada: ${s}`);
  });
  const tx: any = {
    $queryRaw: query,
    $executeRaw: jest.fn(async (_sql: unknown, ...v: any[]) => {
      if (fallo) throw new Error('append falló');
      state.logs.push({ id: v[0], entidad: v[1], entidadId: v[2], accion: v[3], detalle: JSON.parse(v[4]), usuarioId: v[5], espacioId: v[6], proyectoId: v[7], tareaId: v[8], origen: v[9], destino: v[10] });
      return 1;
    }),
    proyecto: {
      create: jest.fn(async ({ data }: any) => { const p = { ...proyecto(`p${++contador}`), ...data, miembros: [] }; state.proyectos.push(p); return p; }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => { const p = state.proyectos.find((p: any) => p.id === where.id); if (!p) throw new Error('ausente'); return p; }),
      update: jest.fn(async ({ where, data }: any) => { const p = state.proyectos.find((p: any) => p.id === where.id); Object.assign(p, data); return p; }),
      delete: jest.fn(async ({ where }: any) => { state.proyectos = state.proyectos.filter((p: any) => p.id !== where.id); state.tareas = state.tareas.filter((t: any) => t.proyectoId !== where.id); }),
    },
    tarea: {
      findUnique: jest.fn(async ({ where }: any) => completa(state.tareas.find((t: any) => t.id === where.id))),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => { const t = completa(state.tareas.find((t: any) => t.id === where.id)); if (!t) throw new Error('ausente'); return t; }),
      create: jest.fn(async ({ data }: any) => { const t = { ...tarea(`t${++contador}`), ...data }; state.tareas.push(t); return completa(t); }),
      update: jest.fn(async ({ where, data }: any) => { const t = state.tareas.find((t: any) => t.id === where.id); Object.assign(t, data); return t; }),
      updateMany: jest.fn(async ({ where, data }: any) => { state.tareas.filter((t: any) => t.tareaPadreId === where.tareaPadreId).forEach((t: any) => Object.assign(t, data)); }),
      delete: jest.fn(async ({ where }: any) => { state.tareas = state.tareas.filter((t: any) => t.id !== where.id && t.tareaPadreId !== where.id); }),
    },
    tareaEtiqueta: { createMany: jest.fn(), deleteMany: jest.fn() },
    proyectoMiembro: { createMany: jest.fn(), deleteMany: jest.fn() },
    membresia: { create: jest.fn() },
    usuario: { create: jest.fn(async ({ data }: any) => { const u = { id: 'nuevo', ...data }; state.usuarios.push(u); return u; }) },
    espacioDeTrabajo: { create: jest.fn(async ({ data }: any) => { const e = { id: 'nuevo-e', ...data }; state.espacios.push(e); return e; }) },
    eventoFinalizacionTarea: { create: jest.fn(async ({ data }: any) => { if (falloDedicado) throw new Error('dedicado falló'); state.dedicados.push(data); return data; }) },
  };
  const db = { $transaction: jest.fn(async (fn: any) => { const antes = snapshot(); try { return await fn(tx); } catch (e) { state = antes; throw e; } }) } as unknown as PrismaService;
  return { tx, state: () => state, snapshot, query, tareas: new PrismaTareaRepository(db), proyectos: new PrismaProyectoRepository(db), usuarios: new PrismaUsuarioRepository(db), espacios: new PrismaEspacioRepository(db), fail: () => { fallo = true; }, failDedicado: () => { falloDedicado = true; }, sinPermiso: () => { miembro = false; }, soloMiembro: () => { rol = 'MIEMBRO'; } };
}

const crearTarea = { titulo: 'privado', proyectoId: 'p', prioridad: 'MEDIA' as const, etiquetasIds: [] };
const crearProyecto = { nombre: 'privado', espacioId: 'e', miembrosIds: ['u'] };
const operaciones: [string, (p: ReturnType<typeof preparar>) => Promise<unknown>][] = [
  ['crear proyecto', p => p.proyectos.crear(crearProyecto, 'u')],
  ['editar proyecto', p => p.proyectos.actualizarAutorizado('p', 'u', { nombre: 'nuevo privado' })],
  ['archivar', p => p.proyectos.actualizar('p', { archivado: true }, 'u')],
  ['borrar proyecto y cascadas', p => p.proyectos.eliminar('p', 'u')],
  ['crear tarea/rápida', p => p.tareas.crear(crearTarea, 'u')],
  ['crear subtarea', p => p.tareas.crearSubtareaAutorizada({ ...crearTarea, tareaPadreId: 't' }, 'u')],
  ['editar tarea', p => p.tareas.actualizar('t', { titulo: 'nuevo privado' }, 'u')],
  ['estado finalizada', p => p.tareas.cambiarEstado('t', 'HECHA', 'u')],
  ['estado normal', p => p.tareas.cambiarEstado('t', 'EN_CURSO', 'u')],
  ['mover padre/hija', p => p.tareas.moverConSubtareas('t', 'q', 'u')],
  ['borrar padre/hija', p => p.tareas.eliminar('t', 'u')],
  ['bandeja registro', p => p.usuarios.crearConEspacioPersonal({ nombre: 'privado', email: 'privado@example.test', passwordHash: 'secreto' })],
  ['bandeja espacio', p => p.espacios.crearConAdmin({ nombre: 'privado', creadorId: 'u' })],
];
describe('historial integrado a escritores: modelo rollback offline NO SQL', () => {
  it.each(operaciones)('%s: éxito incluye evento sin textos', async (_nombre, op) => {
    const p = preparar(); await op(p);
    expect(p.state().logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(p.state().logs)).not.toMatch(/privado|secreto|example/);
  });
  it.each(operaciones)('%s: fallo append revierte negocio y ambos diarios', async (_nombre, op) => {
    const p = preparar(); const antes = p.snapshot(); p.fail();
    await expect(op(p)).rejects.toThrow('append falló');
    expect(p.state()).toEqual(antes);
  });
  it('un dedicado por transición, foto padre RF11 y no-op HECHA', async () => {
    const p = preparar(); await p.tareas.cambiarEstado('t', 'HECHA', 'u');
    await p.tareas.cambiarEstado('t', 'HECHA', 'u');
    expect(p.state().logs).toHaveLength(1); expect(p.state().dedicados).toHaveLength(1);
    expect(p.state().dedicados[0]).toMatchObject({ tipo: 'FINALIZADA', contable: false });
    await p.tareas.cambiarEstado('t', 'PENDIENTE', 'u');
    expect(p.state().dedicados[1]).toMatchObject({ tipo: 'REABIERTA' });
  });
  it('fallo diario dedicado revierte también evento general', async () => {
    const p = preparar(); const antes = p.snapshot(); p.failDedicado();
    await expect(p.tareas.cambiarEstado('t', 'HECHA', 'u')).rejects.toThrow('dedicado falló');
    expect(p.state()).toEqual(antes);
  });
  it('no-op edición, archivo y movimiento sin duplicados', async () => {
    const p = preparar();
    await p.tareas.actualizar('t', { titulo: 'privado', etiquetasIds: [] }, 'u');
    await p.proyectos.actualizarAutorizado('p', 'u', { nombre: 'privado' }, ['u']);
    await p.proyectos.actualizar('p', { archivado: false }, 'u');
    await p.tareas.moverConSubtareas('t', 'p', 'u');
    expect(p.state().logs).toHaveLength(0);
  });
  it('movimiento fija origen/destino para padre e hija sin reescribir pasado', async () => {
    const p = preparar(); await p.tareas.cambiarEstado('h', 'EN_CURSO', 'u');
    await p.tareas.moverConSubtareas('t', 'q', 'u');
    expect(p.state().logs[0].proyectoId).toBe('p');
    expect(p.state().logs.slice(1)).toEqual(expect.arrayContaining(['t', 'h'].map(tareaId => expect.objectContaining({ tareaId, origen: 'p', destino: 'q', proyectoId: 'p' }))));
  });
  it('desarchivar registra una vez', async () => {
    const p = preparar(); p.state().proyectos[0].archivado = true;
    await p.proyectos.actualizar('p', { archivado: false }, 'u');
    await p.proyectos.actualizar('p', { archivado: false }, 'u');
    expect(p.state().logs.map((r: any) => r.accion)).toEqual(['DESARCHIVADO']);
  });
  it('desarchivar rollback y delete fallido después del append revierte todo', async () => {
    const p = preparar(); p.state().proyectos[0].archivado = true;
    const antes = p.snapshot(); p.fail();
    await expect(p.proyectos.actualizar('p', { archivado: false }, 'u')).rejects.toThrow('append falló');
    expect(p.state()).toEqual(antes);
    const q = preparar(); const estado = q.snapshot();
    q.tx.tarea.delete.mockRejectedValue(new Error('delete falló'));
    await expect(q.tareas.eliminar('t', 'u')).rejects.toThrow('delete falló');
    expect(q.state()).toEqual(estado);
  });
  it('proyecto eliminado captura evento por cada tarea/subtarea antes de cascada', async () => {
    const p = preparar(); await p.proyectos.eliminar('p', 'u');
    expect(p.state().tareas).toEqual([]);
    expect(p.state().logs).toEqual(expect.arrayContaining(['t', 'h', 'p'].map(entidadId => expect.objectContaining({ entidadId, accion: 'ELIMINADO', proyectoId: 'p' }))));
  });
  it('revocación actual y archivo impiden escritura; delete proyecto conserva admin', async () => {
    const p = preparar(); p.sinPermiso();
    await expect(p.tareas.eliminar('t', 'u')).rejects.toMatchObject({ status: 404 });
    await expect(p.proyectos.actualizar('p', { archivado: true }, 'u')).rejects.toMatchObject({ status: 404 });
    const q = preparar(); q.state().proyectos[0].archivado = true;
    await expect(q.tareas.actualizar('t', { titulo: 'nuevo' }, 'u')).rejects.toMatchObject({ status: 400 });
    await expect(q.tareas.eliminar('t', 'u')).rejects.toMatchObject({ status: 400 });
    q.soloMiembro(); await expect(q.proyectos.eliminar('p', 'u')).rejects.toMatchObject({ status: 403 });
    expect(q.state().logs).toHaveLength(0);
  });
});
