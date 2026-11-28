import type { EventoFinalizacion } from '../../dominio/metricas/historial-finalizaciones';
import type { EstadoTarea } from '../../dominio/puertos/tarea.repository';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaTareaRepository } from './prisma-tarea.repository';

/**
 * Modelo transaccional en memoria, serializado por una cola FIFO. NO demuestra
 * locks, rollback ni concurrencia reales de PostgreSQL: comprueba la secuencia
 * que el adaptador ejecuta y que el estado anterior se deriva de la fila bloqueada.
 */

interface FilaTarea {
  id: string;
  titulo: string;
  descripcion: null;
  estado: EstadoTarea;
  prioridad: 'MEDIA';
  fechaLimite: null;
  fechaFinalizacion: Date | null;
  proyectoId: string;
  responsableId: null;
  tareaPadreId: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
}

interface FilaProyecto {
  id: string;
  espacioId: string;
  archivado: boolean;
}

function preparar() {
  const base = new Date('2026-11-26T12:00:00.000Z');
  let reloj = new Date(base);
  let tareas: FilaTarea[] = [];
  let proyectos: FilaProyecto[] = [
    { id: 'p1', espacioId: 'e1', archivado: false },
    { id: 'p2', espacioId: 'e1', archivado: false },
  ];
  let miembros: Record<string, string[]> = { e1: ['u1'], e2: [] };
  let eventos: EventoFinalizacion[] = [];
  let falloEvento = false;
  let updates = 0;
  let cola = Promise.resolve();
  const consultas: string[] = [];

  const tarea = (id: string, estado: EstadoTarea, proyectoId = 'p1', padre: string | null = null): FilaTarea => ({
    id,
    titulo: `Tarea ${id}`,
    descripcion: null,
    estado,
    prioridad: 'MEDIA',
    fechaLimite: null,
    fechaFinalizacion: estado === 'HECHA' ? new Date('2026-11-20T08:00:00.000Z') : null,
    proyectoId,
    responsableId: null,
    tareaPadreId: padre,
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
    actualizadoEn: new Date('2026-11-01T00:00:00.000Z'),
  });

  const buscar = (id: string) => tareas.find((t) => t.id === id);

  const completa = (fila: FilaTarea) => ({
    ...fila,
    responsable: null,
    etiquetas: [],
    _count: { subtareas: tareas.filter((h) => h.tareaPadreId === fila.id).length },
  });

  const serializar = <T>(fn: () => Promise<T>): Promise<T> => {
    const resultado = cola.then(fn);
    cola = resultado.then(() => undefined, () => undefined);
    return resultado;
  };

  const crearTx = () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      tarea: {
        findUnique: jest.fn(async (args: { where: { id: string }; select?: unknown; include?: unknown }) => {
          const fila = buscar(args.where.id);
          if (!fila) return null;
          if (args.select && !args.include) return { proyectoId: fila.proyectoId };
          return completa(fila);
        }),
        update: jest.fn(async (args: { where: { id: string }; data: Partial<FilaTarea> }) => {
          const fila = buscar(args.where.id);
          if (!fila) throw new Error('no existe');
          Object.assign(fila, args.data, { actualizadoEn: new Date(reloj) });
          updates += 1;
          return fila;
        }),
      },
      eventoFinalizacionTarea: {
        create: jest.fn(async (args: { data: Omit<EventoFinalizacion, 'id'> }) => {
          if (falloEvento) throw new Error('fallo al registrar evento');
          const evento: EventoFinalizacion = { id: `ev-${eventos.length + 1}`, ...args.data };
          eventos.push(evento);
          return evento;
        }),
      },
      $queryRaw: jest.fn(async (sql: TemplateStringsArray, ...valores: unknown[]) => {
        const texto = sql.join('?');
        consultas.push(texto);
        if (texto.includes('clock_timestamp')) return [{ ahora: new Date(reloj) }];
        if (texto.includes('"tareaPadreId"')) {
          return tareas.filter((h) => h.tareaPadreId === valores[0]).map((h) => ({ id: h.id }));
        }
        if (texto.includes('FROM "tareas" WHERE "id"')) {
          const fila = buscar(String(valores[0]));
          return fila ? [{ proyectoId: fila.proyectoId, estado: fila.estado }] : [];
        }
        if (texto.includes('FROM "proyectos"')) {
          const proyecto = proyectos.find((p) => p.id === valores[0]);
          return proyecto ? [{ espacioId: proyecto.espacioId, archivado: proyecto.archivado }] : [];
        }
        if (texto.includes('FROM "usuarios"')) return [{ id: valores[0] }];
        if (texto.includes('FROM "membresias"')) {
          const espacioId = String(valores[0]);
          const usuarios = valores[1] as string[];
          return (miembros[espacioId] ?? [])
            .filter((u) => usuarios.includes(u))
            .map((usuarioId) => ({ usuarioId }));
        }
        return [];
      }),
    };
    return tx;
  };

  const db = {
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      serializar(async () => {
        const antesTareas = structuredClone(tareas);
        const antesEventos = structuredClone(eventos);
        try {
          return await fn(crearTx());
        } catch (error) {
          tareas = antesTareas;
          eventos = antesEventos;
          throw error;
        }
      })),
    tarea: { findFirst: jest.fn().mockResolvedValue({ id: 't' }) },
  };

  const repo = new PrismaTareaRepository(db as unknown as PrismaService);

  return {
    repo,
    consultas,
    eventos: () => eventos,
    tarea: buscar,
    crearTarea: (...args: Parameters<typeof tarea>) => {
      const fila = tarea(...args);
      tareas.push(fila);
      return fila;
    },
    setMiembros: (valor: Record<string, string[]>) => {
      miembros = valor;
    },
    archivar: (id: string, archivado = true) => {
      const proyecto = proyectos.find((p) => p.id === id);
      if (proyecto) proyecto.archivado = archivado;
    },
    mover: (id: string, proyectoId: string) => {
      const fila = buscar(id);
      if (fila) fila.proyectoId = proyectoId;
    },
    borrarTareaYProyectos: () => {
      tareas = [];
      proyectos = [];
    },
    fallarEvento: (valor = true) => {
      falloEvento = valor;
    },
    avanzarReloj: (ms: number) => {
      reloj = new Date(reloj.getTime() + ms);
    },
    updates: () => updates,
  };
}

describe('RF22 cambio de estado transaccional y evento (dobles, no SQL real)', () => {
  it('HECHA→HECHA es no-op: no reescribe fecha, no actualiza ni registra, no lee reloj', async () => {
    const p = preparar();
    const fila = p.crearTarea('t', 'HECHA');
    const fechaOriginal = fila.fechaFinalizacion;
    const respuesta = await p.repo.cambiarEstado('t', 'HECHA', 'u1');
    expect(respuesta.estado).toBe('HECHA');
    expect(respuesta.fechaFinalizacion).toBe(fechaOriginal);
    expect(p.updates()).toBe(0);
    expect(p.eventos()).toHaveLength(0);
    expect(p.consultas.some((c) => c.includes('clock_timestamp'))).toBe(false);
  });

  it('PENDIENTE→HECHA registra FINALIZADA con reloj de BD, proyecto y contable', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    const respuesta = await p.repo.cambiarEstado('t', 'HECHA', 'u1');
    expect(respuesta.estado).toBe('HECHA');
    expect(respuesta.fechaFinalizacion).toEqual(new Date('2026-11-26T12:00:00.000Z'));
    expect(p.eventos()).toEqual([
      expect.objectContaining({
        tareaId: 't',
        proyectoId: 'p1',
        estadoAnterior: 'PENDIENTE',
        estadoNuevo: 'HECHA',
        tipo: 'FINALIZADA',
        usuarioId: 'u1',
        contable: true,
        ocurridoEn: new Date('2026-11-26T12:00:00.000Z'),
      }),
    ]);
  });

  it('HECHA→EN_CURSO registra REABIERTA y limpia fechaFinalizacion', async () => {
    const p = preparar();
    p.crearTarea('t', 'HECHA');
    const respuesta = await p.repo.cambiarEstado('t', 'EN_CURSO', 'u1');
    expect(respuesta.fechaFinalizacion).toBeNull();
    expect(p.eventos()).toEqual([
      expect.objectContaining({
        estadoAnterior: 'HECHA',
        estadoNuevo: 'EN_CURSO',
        tipo: 'REABIERTA',
      }),
    ]);
  });

  it('recompletar crea una segunda FINALIZADA, sin borrar la primera', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    await p.repo.cambiarEstado('t', 'HECHA', 'u1');
    await p.repo.cambiarEstado('t', 'EN_CURSO', 'u1');
    p.avanzarReloj(3 * 24 * 60 * 60 * 1000);
    await p.repo.cambiarEstado('t', 'HECHA', 'u1');
    expect(p.eventos().map((e) => e.tipo)).toEqual(['FINALIZADA', 'REABIERTA', 'FINALIZADA']);
    expect(p.eventos()[2]?.ocurridoEn).toEqual(new Date('2026-11-29T12:00:00.000Z'));
  });

  it('estados intermedios no generan evento ni tocan fechaFinalizacion', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    await p.repo.cambiarEstado('t', 'EN_CURSO', 'u1');
    await p.repo.cambiarEstado('t', 'PENDIENTE', 'u1');
    expect(p.eventos()).toHaveLength(0);
    expect(p.tarea('t')?.fechaFinalizacion).toBeNull();
    expect(p.updates()).toBe(2);
  });

  it('si falla el registro del evento, la actualización de la tarea revierte', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    p.fallarEvento(true);
    await expect(p.repo.cambiarEstado('t', 'HECHA', 'u1')).rejects.toThrow('fallo al registrar evento');
    expect(p.tarea('t')?.estado).toBe('PENDIENTE');
    expect(p.tarea('t')?.fechaFinalizacion).toBeNull();
    expect(p.eventos()).toHaveLength(0);
  });

  it('dos PATCH concurrentes a HECHA no duplican FINALIZADA', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    const [a, b] = await Promise.all([
      p.repo.cambiarEstado('t', 'HECHA', 'u1'),
      p.repo.cambiarEstado('t', 'HECHA', 'u1'),
    ]);
    expect(a.estado).toBe('HECHA');
    expect(b.estado).toBe('HECHA');
    expect(p.eventos()).toHaveLength(1);
    expect(p.eventos()[0]?.tipo).toBe('FINALIZADA');
  });

  it('transiciones concurrentes mantienen una cadena coherente, sin invertir ni duplicar', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    await Promise.all([
      p.repo.cambiarEstado('t', 'HECHA', 'u1'),
      p.repo.cambiarEstado('t', 'EN_CURSO', 'u1'),
    ]);
    expect(p.eventos()).toHaveLength(2);
    expect(p.eventos()).toEqual([
      expect.objectContaining({ estadoAnterior: 'PENDIENTE', estadoNuevo: 'HECHA', tipo: 'FINALIZADA' }),
      expect.objectContaining({ estadoAnterior: 'HECHA', estadoNuevo: 'EN_CURSO', tipo: 'REABIERTA' }),
    ]);
    expect(p.tarea('t')?.estado).toBe('EN_CURSO');
  });

  it('sin membresía no hay evento ni actualización; 404 genérico', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    p.setMiembros({ e1: [], e2: [] });
    await expect(p.repo.cambiarEstado('t', 'HECHA', 'ajeno')).rejects.toMatchObject({
      status: 404,
      message: 'Tarea no encontrada',
    });
    expect(p.updates()).toBe(0);
    expect(p.eventos()).toHaveLength(0);
  });

  it('proyecto archivado rechaza la transición sin evento', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    p.archivar('p1');
    await expect(p.repo.cambiarEstado('t', 'HECHA', 'u1')).rejects.toMatchObject({
      status: 400,
      message: 'El proyecto está archivado',
    });
    expect(p.eventos()).toHaveLength(0);
  });

  it('tarea con subtareas no es contable; la subtarea sí, y el padre no se duplica', async () => {
    const p = preparar();
    p.crearTarea('padre', 'PENDIENTE');
    p.crearTarea('hijo', 'PENDIENTE', 'p1', 'padre');
    await p.repo.cambiarEstado('padre', 'HECHA', 'u1');
    await p.repo.cambiarEstado('hijo', 'HECHA', 'u1');
    expect(p.eventos()).toEqual([
      expect.objectContaining({ tareaId: 'padre', contable: false, tipo: 'FINALIZADA' }),
      expect.objectContaining({ tareaId: 'hijo', contable: true, tipo: 'FINALIZADA' }),
    ]);
  });

  it('el borrado físico de tarea y proyecto no elimina eventos', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    await p.repo.cambiarEstado('t', 'HECHA', 'u1');
    p.borrarTareaYProyectos();
    expect(p.eventos()).toHaveLength(1);
    expect(p.eventos()[0]).toEqual(expect.objectContaining({ tareaId: 't', proyectoId: 'p1' }));
  });

  it('el movimiento no reatribuye el evento anterior y el nuevo usa el proyecto actual', async () => {
    const p = preparar();
    p.crearTarea('t', 'PENDIENTE');
    await p.repo.cambiarEstado('t', 'HECHA', 'u1');
    p.mover('t', 'p2');
    await p.repo.cambiarEstado('t', 'EN_CURSO', 'u1');
    expect(p.eventos()[0]).toEqual(expect.objectContaining({ proyectoId: 'p1', tipo: 'FINALIZADA' }));
    expect(p.eventos()[1]).toEqual(expect.objectContaining({ proyectoId: 'p2', tipo: 'REABIERTA' }));
  });
});
