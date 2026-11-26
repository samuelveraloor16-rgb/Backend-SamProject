import { PrismaComentariosRepository } from './prisma-comentarios.repository';
import type { PrismaService } from '../prisma/prisma.service';
import type { NuevoPush } from '../../dominio/puertos/push-outbox.repository';
import { ExpoPushProvider } from '../push/expo-push.provider';

/** Doble transaccional: no acredita locks ni rollback reales de PostgreSQL. */
function preparar() {
  let miembros = new Set(['autor', 'responsable', ...Array.from({ length: 20 }, (_, i) => `u${i}`)]);
  let responsableId: string | null = 'responsable';
  let eventos: NuevoPush[] = [];
  let avisos: unknown[] = [];
  let identidades = new Set<string>();
  let comentario: any = null;
  let marcador: any = null;
  let fallo = '';
  let espacioId = 'e';
  let dentro = false;
  const consultas: string[] = [];
  const proveedor = jest.spyOn(ExpoPushProvider.prototype, 'enviar').mockRejectedValue(new Error('HTTP prohibido'));
  const tx = {
    $queryRaw: jest.fn(async (sql: TemplateStringsArray, ...args: unknown[]) => {
      const texto = sql.join('?'); consultas.push(texto);
      if (texto.includes('clock_timestamp')) return [{ ahora: new Date() }];
      if (texto.includes('FROM "proyectos"')) return [{ espacioId, archivado: false }];
      if (texto.includes('FROM "tareas"')) return [{ proyectoId: 'p', responsableId }];
      if (texto.includes('FROM "membresias"')) return miembros.has(args[1] as string) ? [{ usuarioId: args[1] }] : [];
      return [];
    }),
    $executeRaw: jest.fn(async () => 1),
    comentario: {
      create: jest.fn(async ({ data }: any) => {
        comentario = { ...data, id: 'c', autor: { id: 'autor', nombre: 'Autor' }, menciones: data.menciones.create.map((m: any) => ({ usuario: { id: m.usuarioId, nombre: m.usuarioId } })) };
        return comentario;
      }),
      findUnique: jest.fn(async () => comentario),
    },
    idempotenciaComentario: {
      findUnique: jest.fn(async ({ where }: any) => marcador?.clave === where.usuarioId_clave.clave ? marcador : null),
      create: jest.fn(async ({ data }: any) => { if (fallo === 'marcador') throw new Error('marcador'); marcador = data; return data; }),
      update: jest.fn(), delete: jest.fn(),
    },
    identidadAviso: { createMany: jest.fn(async ({ data }: { data: { digest: string }[] }) => {
      if (identidades.has(data[0]!.digest)) return { count: 0 };
      identidades.add(data[0]!.digest); return { count: 1 };
    }) },
    notificacion: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: { data: unknown }) => { avisos.push(data); return data; }) },
    preferenciaNotificacion: { findUnique: jest.fn(async () => null) },
    pushOutbox: { createMany: jest.fn(async ({ data, skipDuplicates }: { data: NuevoPush[]; skipDuplicates: boolean }) => {
      expect(dentro).toBe(true); expect(skipDuplicates).toBe(true); expect(proveedor).not.toHaveBeenCalled();
      if (fallo === 'outbox') throw new Error('outbox');
      const nuevas = data.filter(e => !eventos.some(o => o.claveUnica === e.claveUnica)); eventos.push(...nuevas); return { count: nuevas.length };
    }) },
  };
  const db = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
    const antes = { comentario, marcador, eventos: [...eventos], avisos: [...avisos], identidades: new Set(identidades) }; dentro = true;
    try { return await fn(tx); }
    catch (e) { comentario = antes.comentario; marcador = antes.marcador; eventos = antes.eventos; avisos = antes.avisos; identidades = antes.identidades; throw e; }
    finally { dentro = false; }
  }) };
  return { repo: new PrismaComentariosRepository(db as unknown as PrismaService), tx, consultas, proveedor,
    eventos: () => eventos, avisos: () => avisos, identidades: () => [...identidades], comentario: () => comentario, marcador: () => marcador,
    configurar: (c: { miembros?: string[]; responsableId?: string | null; fallo?: string; espacioId?: string }) => {
      if (c.miembros) miembros = new Set(c.miembros);
      if (c.responsableId !== undefined) responsableId = c.responsableId;
      if (c.fallo !== undefined) fallo = c.fallo;
      if (c.espacioId) espacioId = c.espacioId;
    } };
}

describe('RF20 comentarios: unión durable sin autoaviso ni replay de efectos', () => {
  beforeAll(() => {
    process.env.COMENTARIOS_HMAC_CLAVES = JSON.stringify({ test: 'ab'.repeat(32) });
    process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA = 'test';
  });
  afterAll(() => { delete process.env.COMENTARIOS_HMAC_CLAVES; delete process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA; });
  afterEach(() => jest.restoreAllMocks());
  const veinte = Array.from({ length: 20 }, (_, i) => `u${i}`);
  it('20 mencionados + responsable adicional = 21 destinatarios; claves únicas y sin contenido privado', async () => {
    const p = preparar(); await p.repo.crear('t', 'autor', 'privado', 'k', veinte);
    expect(p.eventos()).toHaveLength(21);
    expect(new Set(p.eventos().map(e => e.claveUnica)).size).toBe(21);
    expect(p.eventos().find(e => e.usuarioId === 'responsable')).toEqual({ claveUnica: 'com:c:responsable', usuarioId: 'responsable', tipo: 'COMENTARIO', tareaId: 't', comentarioId: 'c' });
    expect(p.eventos().filter(e => e.tipo === 'MENCION')).toHaveLength(20);
    expect(p.proveedor).not.toHaveBeenCalled();
  });
  it('automención ocupa uno de los 20 lugares RF19, pero no recibe push', async () => {
    const p = preparar(); await p.repo.crear('t', 'autor', 'x', 'k', ['autor', ...veinte.slice(0, 19)]);
    expect(p.eventos()).toHaveLength(20); expect(p.eventos().some(e => e.usuarioId === 'autor')).toBe(false);
    expect(p.comentario().menciones).toHaveLength(20);
  });
  it('responsable mencionado tiene precedencia MENCION y una sola fila', async () => {
    const p = preparar(); await p.repo.crear('t', 'autor', 'x', 'k', ['responsable']);
    expect(p.eventos()).toEqual([{ claveUnica: 'com:c:responsable', usuarioId: 'responsable', tipo: 'MENCION', tareaId: 't', comentarioId: 'c' }]);
    expect(p.avisos()).toEqual([{ usuarioId: 'responsable', tipo: 'MENCION', titulo: 'Te mencionaron', cuerpo: null, tareaId: 't', comentarioId: 'c' }]);
  });
  it.each([null, 'autor'])('sin responsable elegible adicional: %s', async responsableId => {
    const p = preparar(); p.configurar({ responsableId }); await p.repo.crear('t', 'autor', 'x', 'k', []); expect(p.eventos()).toEqual([]);
  });
  it('replay no vuelve a encolar ni revalidar mencionados que perdieron acceso', async () => {
    const p = preparar(); await p.repo.crear('t', 'autor', 'x', 'k', ['u0']);
    p.configurar({ miembros: ['autor'] });
    expect((await p.repo.crear('t', 'autor', 'x', 'k', ['u0'])).replay).toBe(true);
    expect(p.tx.pushOutbox.createMany).toHaveBeenCalledTimes(2);
    p.configurar({ miembros: [] });
    await expect(p.repo.crear('t', 'autor', 'x', 'k', ['u0'])).rejects.toMatchObject({ status: 404 });
    expect(p.eventos()).toHaveLength(2); expect(p.tx.comentario.create).toHaveBeenCalledTimes(1);
  });
  it.each(['outbox', 'marcador'])('fallo %s revierte comentario, avisos, identidad, marcador y outbox en el doble', async fallo => {
    const p = preparar(); p.configurar({ fallo });
    await expect(p.repo.crear('t', 'autor', 'x', 'k', ['u0'])).rejects.toThrow(fallo);
    expect(p.comentario()).toBeNull(); expect(p.marcador()).toBeNull(); expect(p.eventos()).toEqual([]);
    expect(p.avisos()).toEqual([]); expect(p.identidades()).toEqual([]);
  });
  it('responsable que perdió membresía se excluye; mencionado inválido aborta', async () => {
    const p = preparar(); p.configurar({ miembros: ['autor', 'u0'] });
    await p.repo.crear('t', 'autor', 'x', 'k', ['u0']); expect(p.eventos().map(e => e.usuarioId)).toEqual(['u0']);
    await expect(p.repo.crear('t', 'autor', 'y', 'otra', ['responsable'])).rejects.toMatchObject({ status: 400 });
  });
  it('aislamiento: membresías de otro espacio no autorizan publicar ni encolar', async () => {
    const p = preparar(); p.configurar({ espacioId: 'otro', miembros: [] });
    await expect(p.repo.crear('t', 'autor', 'x', 'k', ['u0'])).rejects.toMatchObject({ status: 404 });
    expect(p.tx.comentario.create).not.toHaveBeenCalled(); expect(p.eventos()).toEqual([]);
    expect(p.tx.$queryRaw.mock.calls.some(([sql, ...args]) => sql.join('').includes('FROM "membresias"') && args[0] === 'otro')).toBe(true);
  });
  it('consulta asignación bajo SHARE y bloquea usuarios antes de membresías', async () => {
    const p = preparar(); await p.repo.crear('t', 'autor', 'x', 'k', ['u0']);
    expect(p.consultas.some(q => q.includes('"responsableId"') && q.includes('FOR SHARE'))).toBe(true);
    const primeraMembresia = p.consultas.findIndex(q => q.includes('FROM "membresias"'));
    expect(p.consultas.slice(primeraMembresia).some(q => q.includes('FROM "usuarios"'))).toBe(false);
    expect(p.tx.$queryRaw.mock.calls.some(([sql, ...args]) => sql.join('').includes('FROM "usuarios"') && args[0] === 'responsable')).toBe(true);
  });
});
