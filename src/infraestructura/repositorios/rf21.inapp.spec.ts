import type { Prisma } from '@prisma/client';
import { registrarAviso } from './prisma-inapp.repository';
import type { NuevoPush } from '../../dominio/puertos/push-outbox.repository';
import { PrismaComentariosRepository } from './prisma-comentarios.repository';
import type { PrismaService } from '../prisma/prisma.service';
import { readFileSync } from 'fs';

const base: NuevoPush = { claveUnica: 'com:c:u', usuarioId: 'u', tipo: 'COMENTARIO', tareaId: 't', comentarioId: 'c' };
/** Emula atomicidad para comprobar participación; NO es prueba de rollback PostgreSQL. */
function almacenamiento() {
  let identidades = new Set<string>();
  let filas: unknown[] = [];
  let preferencia: { inApp: boolean; push: boolean } | null = null;
  let fallo = '';
  const tx = {
    identidadAviso: { createMany: jest.fn(async ({ data }: { data: { digest: string }[] }) => {
      if (fallo === 'identidad') throw new Error(fallo);
      const digest = data[0]!.digest;
      if (identidades.has(digest)) return { count: 0 };
      identidades.add(digest); return { count: 1 };
    }) },
    preferenciaNotificacion: { findUnique: jest.fn(async () => { if (fallo === 'preferencia') throw new Error(fallo); return preferencia; }) },
    notificacion: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: unknown }) => { if (fallo === 'aviso') throw new Error(fallo); filas.push(data); return data; }),
    },
  };
  return { tx, filas: () => filas, identidades: () => [...identidades], borrar: () => { filas = []; },
    configurar: (p: typeof preferencia, f = '') => { preferencia = p; fallo = f; },
    ejecutar: async (evento: NuevoPush) => {
      const antes = { identidades: new Set(identidades), filas: [...filas] };
      try { return await registrarAviso(tx as unknown as Prisma.TransactionClient, evento); }
      catch (e) { identidades = antes.identidades; filas = antes.filas; throw e; }
    } };
}

describe('RF21 identidad durable in-app (dobles offline)', () => {
  it.each(['TAREA_ASIGNADA', 'TAREA_POR_VENCER', 'TAREA_VENCIDA', 'COMENTARIO'] as const)('default %s no abre canal y consume identidad', async tipo => {
    const p = almacenamiento(); const e = { ...base, tipo, comentarioId: tipo === 'COMENTARIO' ? 'c' : null };
    expect(await p.ejecutar(e)).toBe(false); expect(p.filas()).toEqual([]);
    p.configurar({ inApp: true, push: false });
    expect(await p.ejecutar(e)).toBe(false); expect(p.filas()).toEqual([]); expect(p.identidades()).toHaveLength(1);
  });
  it('MENCION obligatoria incluso con preferencia simulada inválida; sin contenido privado', async () => {
    const p = almacenamiento(); p.configurar({ inApp: false, push: false });
    expect(await p.ejecutar({ ...base, tipo: 'MENCION' })).toBe(true);
    expect(p.filas()).toEqual([{ usuarioId: 'u', tipo: 'MENCION', titulo: 'Te mencionaron', cuerpo: null, tareaId: 't', comentarioId: 'c' }]);
    expect(p.identidades()[0]).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    { ...base, comentarioId: null },
    { ...base, tipo: 'TAREA_ASIGNADA' as const },
    { ...base, tareaId: '' },
  ])('referencia estructural inválida no consume identidad ni crea aviso', async evento => {
    const p = almacenamiento(); await expect(p.ejecutar(evento)).rejects.toThrow('Evento de aviso inválido');
    expect(p.tx.identidadAviso.createMany).not.toHaveBeenCalled(); expect(p.filas()).toEqual([]);
  });
  it('push false / inApp true crea sin dispositivo ni outbox; borrado y cambio de tipo no permiten replay', async () => {
    const p = almacenamiento(); p.configurar({ inApp: true, push: false });
    expect(await p.ejecutar(base)).toBe(true); p.borrar();
    expect(await p.ejecutar({ ...base, tipo: 'MENCION' })).toBe(false);
    expect(p.filas()).toEqual([]); expect(p.identidades()).toHaveLength(1);
  });
  it('destinatarios independientes y eventos nuevos no se confunden con replay', async () => {
    const p = almacenamiento(); p.configurar({ inApp: true, push: false });
    for (const e of [base, { ...base, usuarioId: 'v' }, { ...base, claveUnica: 'com:otra:u' }]) await p.ejecutar(e);
    expect(p.filas()).toHaveLength(3); expect(p.identidades()).toHaveLength(3);
  });
  it.each(['identidad', 'preferencia', 'aviso'])('fallo %s revierte identidad y aviso en doble transaccional', async fallo => {
    const p = almacenamiento(); p.configurar({ inApp: true, push: false }, fallo);
    await expect(p.ejecutar(base)).rejects.toThrow(fallo);
    expect(p.identidades()).toEqual([]); expect(p.filas()).toEqual([]);
    p.configurar({ inApp: true, push: false }); expect(await p.ejecutar(base)).toBe(true);
  });
  it('legacy legítimo consume identidad sin duplicar aviso', async () => {
    const p = almacenamiento(); p.tx.notificacion.findFirst.mockResolvedValueOnce({} as never);
    expect(await p.ejecutar({ ...base, tipo: 'MENCION' })).toBe(false);
    expect(p.identidades()).toHaveLength(1); expect(p.tx.notificacion.create).not.toHaveBeenCalled();
    expect(p.tx.notificacion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ comentario: { is: { tareaId: 't', menciones: { some: { usuarioId: 'u' } } } } }) }));
  });
  it('tombstone sin FK/privados ni limpieza y migración no destructiva', () => {
    const sql = readFileSync('prisma/migrations/20261126120000_rf21_inapp/migration.sql', 'utf8');
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|DROP|TRUNCATE)\b(?! CASCADE)/);
    expect(sql).toContain('CREATE TABLE "identidades_aviso" ("digest" TEXT NOT NULL PRIMARY KEY)');
    expect(sql).toContain('ON DELETE CASCADE'); // únicamente aviso→tarea, no identidad
  });
});

describe('RF21 consultas propias y referencias (adaptador simulado, no ejecuta SQL)', () => {
  function preparar() {
    const tarea = { id: 't', proyectoId: 'p', proyecto: { espacioId: 'e', archivado: true } };
    const n = { id: 'n', usuarioId: 'u', tipo: 'MENCION', titulo: 'Te mencionaron', cuerpo: null, leida: false, creadoEn: new Date(), comentarioId: 'c', tareaId: null, tarea: null, comentario: { id: 'c', tareaId: 't', tarea } };
    let valido = true; let miembro = true;
    const sentencias: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async (sql: TemplateStringsArray, ...args: unknown[]) => {
        const s = sql.join('?'); sentencias.push(s);
        if (s.includes('FROM "notificaciones"')) return valido && miembro && args.every(a => a === 'u') ? [{ id: 'n' }] : [];
        if (s.includes('FROM "proyectos"')) return [{ espacioId: 'e', archivado: true }];
        if (s.includes('FROM "tareas"')) return [{ proyectoId: 'p', responsableId: 'u' }];
        if (s.includes('FROM "membresias"')) return miembro ? [{ usuarioId: 'u' }] : [];
        return [];
      }),
      notificacion: {
        count: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length),
        findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length ? [n] : []),
        findFirst: jest.fn(async ({ where }: { where: { AND: { id?: { in?: string[] } }[] } }) => where.AND[0]?.id?.in?.length ? n : null),
        updateMany: jest.fn(async () => ({ count: 1 })), findUnique: jest.fn(async () => ({ ...n, leida: true })),
      },
    };
    const db = { $transaction: async (f: (t: typeof tx) => Promise<unknown>) => f(tx) };
    return { repo: new PrismaComentariosRepository(db as unknown as PrismaService), tx, sentencias,
      invalidar: () => { valido = false; }, revocar: () => { miembro = false; } };
  }
  it('legacy MENCION y archivo permiten lectura sin cambiar wire shape', async () => {
    const p = preparar(); const lista = await p.repo.notificaciones('u', 1, 20);
    expect(lista.meta.total).toBe(1); expect(lista.datos[0]!.datos).toEqual({ espacioId: 'e', proyectoId: 'p', tareaId: 't', comentarioId: 'c' });
    expect((await p.repo.leer('n', 'u')).leida).toBe(true);
  });
  it.each(['otra cuenta', 'revocación', 'referencia inválida'])('%s excluye total/listado y PATCH 404 sin escritura', async caso => {
    const p = preparar(); if (caso === 'revocación') p.revocar(); if (caso === 'referencia inválida') p.invalidar();
    const usuario = caso === 'otra cuenta' ? 'v' : 'u';
    const lista = await p.repo.notificaciones(usuario, 1, 20); expect(lista.meta.total).toBe(0); expect(lista.datos).toEqual([]);
    await expect(p.repo.leer('n', usuario)).rejects.toMatchObject({ status: 404 }); expect(p.tx.notificacion.updateMany).not.toHaveBeenCalled();
  });
  it('SQL verifica igualdad tarea/comentario, mención real, JWT y no usa JSON/archivo como autorización', async () => {
    const p = preparar(); await p.repo.notificaciones('u', 1, 20);
    const sql = p.sentencias[0];
    expect(sql).toContain('c."tareaId" = t."id"'); expect(sql).toContain('FROM "menciones"');
    expect(sql).toContain('n."usuarioId" ='); expect(sql).toContain('m."usuarioId" =');
    expect(sql).toContain('n."comentarioId" IS NULL'); expect(sql).not.toContain('"datos"'); expect(sql).not.toContain('"archivado"');
  });
});
