import { PrismaTareaRepository } from './prisma-tarea.repository';
import type { PrismaService } from '../prisma/prisma.service';
import type { NuevoPush } from '../../dominio/puertos/push-outbox.repository';
import { ExpoPushProvider } from '../push/expo-push.provider';

/** Modelo transaccional en memoria; NO demuestra locks ni rollback de PostgreSQL. */
function preparar() {
  let tarea = { id: 't', proyectoId: 'p', responsableId: 'anterior' as string | null, tareaPadreId: null as string | null, etiquetas: [], _count: { subtareas: 0 } };
  let outbox: NuevoPush[] = [];
  let generales: string[] = [];
  let falloHistorial = false;
  let archivado = false;
  let miembros = ['autor', 'nuevo', 'anterior'];
  let fallo = false;
  let falloLectura = false;
  let dentro = false;
  let cola = Promise.resolve();
  const proveedor = jest.spyOn(ExpoPushProvider.prototype, 'enviar').mockImplementation(async () => { throw new Error('No se permite invocar Expo desde negocio'); });
  const consultas: string[] = [];
  const insertar = jest.fn(async ({ data }: { data: NuevoPush[] }) => {
    expect(dentro).toBe(true);
    expect(proveedor).not.toHaveBeenCalled();
    if (fallo) throw new Error('persistencia');
    const nuevas = data.filter(e => !outbox.some(o => o.claveUnica === e.claveUnica));
    outbox.push(...nuevas);
    return { count: nuevas.length };
  });
  const tx = {
    $executeRaw: jest.fn(async (_sql: TemplateStringsArray, ...valores: unknown[]) => {
      expect(dentro).toBe(true);
      if (falloHistorial) throw new Error('historial');
      generales.push(String(valores[3]));
      return 1;
    }),
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) => {
      const texto = sql.join('?');
      consultas.push(texto);
      if (texto.includes('FROM "proyectos"')) return [{ espacioId: 'e', archivado }];
      if (texto.includes('FROM "tareas"')) return [{ ...tarea }];
      if (texto.includes('FROM "membresias"')) return miembros.map(usuarioId => ({ usuarioId }));
      return [{ id: 'usuario' }];
    }),
    tarea: {
      findUniqueOrThrow: jest.fn(async () => ({ ...tarea })),
      findUnique: jest.fn(async ({ select }: { select?: unknown }) => {
        if (!select && falloLectura) throw new Error('lectura');
        return { ...tarea };
      }),
      create: jest.fn(async ({ data }: { data: Partial<typeof tarea> }) => { tarea = { ...tarea, ...data }; return { ...tarea }; }),
      update: jest.fn(async ({ data }: { data: Partial<typeof tarea> }) => { tarea = { ...tarea, ...data }; return { ...tarea }; }),
    },
    pushOutbox: { createMany: insertar },
    identidadAviso: { createMany: jest.fn(async () => ({ count: 1 })) },
    notificacion: { create: jest.fn(async () => ({})) },
    preferenciaNotificacion: { findUnique: jest.fn(async (): Promise<{ inApp: boolean; push: boolean } | null> => null) },
    tareaEtiqueta: { createMany: jest.fn(), deleteMany: jest.fn() },
  };
  const db = {
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => {
      const resultado = cola.then(async () => {
        const antes = { ...tarea }; const eventos = [...outbox]; const historial = [...generales];
        dentro = true;
        try { return await fn(tx); }
        catch (error) { tarea = antes; outbox = eventos; generales = historial; throw error; }
        finally { dentro = false; }
      });
      cola = resultado.then(() => undefined, () => undefined);
      return resultado;
    }),
  };
  return {
    repo: new PrismaTareaRepository(db as unknown as PrismaService), tx, db, insertar, proveedor, consultas,
    eventos: () => outbox, tarea: () => tarea, generales: () => generales,
    configurar: (config: { archivado?: boolean; miembros?: string[]; fallo?: boolean; falloLectura?: boolean; falloHistorial?: boolean }) => {
      archivado = config.archivado ?? archivado; miembros = config.miembros ?? miembros;
      fallo = config.fallo ?? fallo; falloLectura = config.falloLectura ?? falloLectura;
      falloHistorial = config.falloHistorial ?? falloHistorial;
    },
  };
}

describe('RF20 asignaciones: negocio y outbox en la misma transacción', () => {
  afterEach(() => jest.restoreAllMocks());
  const datos = { titulo: 'Privado', prioridad: 'MEDIA' as const, proyectoId: 'p', etiquetasIds: [], responsableId: 'nuevo' };
  it('creación asignada encola solo al nuevo responsable con clave no nullable', async () => {
    const p = preparar();
    await p.repo.crear(datos, 'autor');
    expect(p.eventos()).toEqual([{ claveUnica: expect.stringMatching(/^asig:/), usuarioId: 'nuevo', tipo: 'TAREA_ASIGNADA', tareaId: 't', comentarioId: null }]);
    expect(p.insertar).toHaveBeenCalledWith({ data: p.eventos(), skipDuplicates: true });
    expect(p.proveedor).not.toHaveBeenCalled();
  });
  it('asignación inApp explícita sin push comparte identidad del cambio y no depende de dispositivos', async () => {
    const p = preparar(); p.tx.preferenciaNotificacion.findUnique.mockResolvedValue({ inApp: true, push: false });
    await p.repo.crear(datos, 'autor');
    expect(p.eventos()).toEqual([]);
    expect(p.tx.notificacion.create).toHaveBeenCalledWith({ data: { usuarioId: 'nuevo', tipo: 'TAREA_ASIGNADA', titulo: 'Tarea asignada', cuerpo: null, tareaId: 't', comentarioId: null } });
    expect(p.tx.identidadAviso.createMany).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, 'autor'])('creación sin autoaviso: responsable=%s', async responsableId => {
    const p = preparar(); await p.repo.crear({ ...datos, responsableId }, 'autor');
    expect(p.eventos()).toHaveLength(0);
  });
  it.each([{}, { responsableId: 'anterior' }, { responsableId: null }, { responsableId: 'autor' }, { estado: 'HECHA' as const }])('PATCH no genera eventos por ausencia/noop/desasignación/autoasignación/estado: %j', async cambio => {
    const p = preparar(); await p.repo.actualizar('t', cambio, 'autor');
    expect(p.eventos()).toHaveLength(0);
  });
  it('cambio efectivo y replay del mismo PATCH producen un solo evento', async () => {
    const p = preparar();
    await p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor');
    await p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor');
    expect(p.eventos()).toHaveLength(1);
    expect(p.eventos()[0]?.usuarioId).toBe('nuevo');
    expect(p.consultas.some(c => c.includes('"responsableId"') && c.includes('FOR UPDATE'))).toBe(true);
  });
  it('A→B→A conserva eventos distintos aunque comentarioId sea NULL', async () => {
    const p = preparar();
    await p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor');
    await p.repo.actualizar('t', { responsableId: 'anterior' }, 'autor');
    expect(p.eventos()).toHaveLength(2);
    expect(new Set(p.eventos().map(e => e.claveUnica)).size).toBe(2);
    expect(p.eventos().every(e => e.comentarioId === null)).toBe(true);
  });
  it('simula dos PATCH concurrentes serializados por lock: solo uno cambia', async () => {
    const p = preparar();
    await Promise.all([p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor'), p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor')]);
    expect(p.eventos()).toHaveLength(1);
  });
  it.each(['crear', 'actualizar', 'subtarea'])('responsable inválido rechaza %s sin escritura parcial', async operacion => {
    const p = preparar(); p.configurar({ miembros: ['autor'] });
    const promesa = operacion === 'crear' ? p.repo.crear(datos, 'autor') : operacion === 'actualizar' ? p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor') : p.repo.crearSubtareaAutorizada({ ...datos, tareaPadreId: 't' }, 'autor');
    await expect(promesa).rejects.toMatchObject({ status: 400 });
    expect(p.eventos()).toHaveLength(0); expect(p.tx.tarea.update).not.toHaveBeenCalled(); expect(p.tx.tarea.create).not.toHaveBeenCalled();
  });
  it.each(['crear', 'actualizar', 'subtarea'])('archivo y revocación bloquean %s', async operacion => {
    const p = preparar();
    const ejecutar = () => operacion === 'crear' ? p.repo.crear(datos, 'autor') : operacion === 'actualizar' ? p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor') : p.repo.crearSubtareaAutorizada({ ...datos, tareaPadreId: 't' }, 'autor');
    p.configurar({ archivado: true }); await expect(ejecutar()).rejects.toMatchObject({ status: 400 });
    p.configurar({ archivado: false, miembros: ['nuevo'] }); await expect(ejecutar()).rejects.toMatchObject({ status: 404 });
    expect(p.eventos()).toHaveLength(0);
  });
  it.each(['crear', 'actualizar', 'subtarea'])('fallo del outbox revierte %s, sin reintento ambiguo', async operacion => {
    const p = preparar(); p.configurar({ fallo: true });
    const antes = p.tarea();
    const promesa = operacion === 'crear' ? p.repo.crear(datos, 'autor') : operacion === 'actualizar' ? p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor') : p.repo.crearSubtareaAutorizada({ ...datos, tareaPadreId: 't' }, 'autor');
    await expect(promesa).rejects.toThrow('persistencia');
    expect(p.tarea()).toEqual(antes); expect(p.eventos()).toHaveLength(0); expect(p.db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('fallo posterior al encolado revierte también outbox', async () => {
    const p = preparar(); p.configurar({ falloLectura: true });
    await expect(p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor')).rejects.toThrow('lectura');
    expect(p.tarea().responsableId).toBe('anterior'); expect(p.eventos()).toHaveLength(0);
    expect(p.generales()).toHaveLength(0);
  });
  it('fallo de auditoría revierte asignación y outbox ya encolado', async () => {
    const p = preparar(); p.configurar({ falloHistorial: true });
    await expect(p.repo.actualizar('t', { responsableId: 'nuevo' }, 'autor')).rejects.toThrow('historial');
    expect(p.tarea().responsableId).toBe('anterior'); expect(p.eventos()).toHaveLength(0);
    expect(p.generales()).toHaveLength(0);
  });
  it.each(['nuevo', 'autor'])('subtarea incluye asignación, sin autoaviso: %s', async responsableId => {
    const p = preparar();
    await p.repo.crearSubtareaAutorizada({ ...datos, responsableId, tareaPadreId: 't' }, 'autor');
    expect(p.eventos()).toHaveLength(responsableId === 'autor' ? 0 : 1);
    expect(p.proveedor).not.toHaveBeenCalled();
  });
});
