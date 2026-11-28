import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaHistorialRepository } from './prisma-historial.repository';
import { CursorHistorialCodec } from './cursor';

/** Vérifie contrôle de flux/projection et SQL produit, PAS exécution PostgreSQL. */
function preparar() {
  const ahora = new Date('2026-11-27T12:00:00.000Z');
  const findFirst = jest.fn().mockResolvedValue({ espacioId: 'e' });
  const tarea = jest.fn().mockResolvedValue({ proyecto: { espacioId: 'e' } });
  let filas: unknown[] = [];
  let sqlPagina: Prisma.Sql | undefined;
  const query = jest.fn(async (sql: Prisma.Sql | TemplateStringsArray) => {
    const text = Array.isArray(sql) ? sql.join('?') : (sql as Prisma.Sql).strings.join('?');
    if (text.includes('pg_advisory')) return [];
    if (text.includes('clock_timestamp')) return [{ ahora }];
    if (text.includes('FROM "membresias"')) return [{ usuarioId: 'u' }];
    sqlPagina = sql as Prisma.Sql;
    return filas;
  });
  const tx = { proyecto: { findFirst }, tarea: { findFirst: tarea }, $queryRaw: query };
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
  const config = { get: jest.fn().mockReturnValue('testkey') };
  const repo = new PrismaHistorialRepository({ $transaction: transaction } as unknown as PrismaService, config as unknown as ConfigService);
  return { repo, query, config, findFirst, tarea, ahora, setFilas: (f: unknown[]) => { filas = f; }, sql: () => sqlPagina! };
}
const fila = (id: string) => ({ id, entidad: 'TAREA', entidadId: 't', accion: 'ESTADO_CAMBIADO', detalle: { estadoAnterior: 'PENDIENTE', estadoNuevo: 'HECHA' }, usuarioId: null, actorTipo: 'USUARIO', creadoEn: new Date('2026-11-26T12:00:00.000Z') });
describe('lector historial integrado offline: autorización/paginación y forma SQL', () => {
  it('recurso borrado/ajeno indistinguible404 antes validación/clave/query', async () => {
    const p = preparar(); p.findFirst.mockResolvedValue(null); p.config.get.mockReturnValue(undefined);
    await expect(p.repo.listar('PROYECTO', 'borrado', 'u', { cursor: '%' })).rejects.toMatchObject({ status: 404, message: 'Recurso no encontrado' });
    expect(p.config.get).not.toHaveBeenCalled();
    expect(p.sql()).toBeUndefined();
    p.tarea.mockResolvedValue(null);
    await expect(p.repo.listar('TAREA', 'borrado', 'u', {})).rejects.toMatchObject({ status: 404, message: 'Recurso no encontrado' });
  });
  it('autoriza por membresía actual y permite archivados sin filtro', async () => {
    const p = preparar(); await p.repo.listar('PROYECTO', 'p', 'u', {});
    expect(p.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p', eliminadoEn: null, espacio: { membresias: { some: { usuarioId: 'u' } } } } }));
    expect(p.sql().values).toContain(21);
  });
  it.each([{ limite: '0' }, { limite: '101' }, { limite: '1.5' }, { limite: ['20'] }, { offset: '1' }, { cursor: '' }])('rechaza query %j', async query => {
    const p = preparar(); await expect(p.repo.listar('TAREA', 't', 'u', query)).rejects.toMatchObject({ status: 400 });
  });
  it('100 aceptado, clave ausente falla cerrado incluso vacío', async () => {
    const p = preparar(); await p.repo.listar('TAREA', 't', 'u', { limite: '100' });
    expect(p.sql().values).toContain(101);
    await expect(p.repo.listar('TAREA', 't', 'u', {}, { token: 'no-admitido' })).rejects.toMatchObject({ status: 400 });
    p.config.get.mockReturnValue(undefined);
    await expect(p.repo.listar('TAREA', 't', 'u', {})).rejects.toMatchObject({ status: 503 });
  });
  it('keyset de empates preserva última pareja, corte y scope usuario/recurso/espacio/límite', async () => {
    const p = preparar(); p.setFilas([fila('c'), fila('b'), fila('a')]);
    const result = await p.repo.listar('TAREA', 't', 'u', { limite: '2' }) as { datos: unknown[]; meta: { siguienteCursor: string } };
    expect(result.datos).toHaveLength(2);
    expect(result.datos[0]).toMatchObject({ actor: { tipo: 'USUARIO', id: null } });
    const codec = new CursorHistorialCodec('testkey');
    const cursor = codec.decode(result.meta.siguienteCursor, JSON.stringify(['TAREA', 't', 'e', 'u', 2]));
    expect(cursor).toMatchObject({ id: 'b', fecha: fila('b').creadoEn.toISOString(), corte: p.ahora.toISOString() });
    p.setFilas([]);
    await p.repo.listar('TAREA', 't', 'u', { limite: '2', cursor: result.meta.siguienteCursor });
    expect(p.sql().strings.join('?')).toContain('(r."creadoEn", r."id") <');
    expect(p.sql().values).toContain('b');
    for (const [tipo, id, user, limite] of [['TAREA', 'otro', 'u', '2'], ['TAREA', 't', 'otro', '2'], ['PROYECTO', 't', 'u', '2'], ['TAREA', 't', 'u', '3']]) {
      await expect(p.repo.listar(tipo as 'TAREA', id!, user!, { limite, cursor: result.meta.siguienteCursor })).rejects.toMatchObject({ status: 400 });
    }
    p.tarea.mockResolvedValue({ proyecto: { espacioId: 'otro-espacio' } });
    await expect(p.repo.listar('TAREA', 't', 'u', { limite: '2', cursor: result.meta.siguienteCursor })).rejects.toMatchObject({ status: 400 });
  });
  it('corte180d incluye igualdad, anterior/futuro rechazados; orden y filtros ANTES LIMIT', async () => {
    const p = preparar(); const codec = new CursorHistorialCodec('testkey');
    const scope = JSON.stringify(['PROYECTO', 'p', 'e', 'u', 20]);
    const minimo = new Date(p.ahora.getTime() - 180 * 86400000);
    const cursor = (date: Date) => codec.encode({ v: 1, scope, corte: date.toISOString(), fecha: date.toISOString(), id: 'a' });
    await p.repo.listar('PROYECTO', 'p', 'u', { cursor: cursor(minimo) });
    expect(p.sql().values).toContainEqual(minimo);
    for (const date of [new Date(minimo.getTime() - 1), new Date(p.ahora.getTime() + 1)]) {
      await expect(p.repo.listar('PROYECTO', 'p', 'u', { cursor: cursor(date) })).rejects.toMatchObject({ status: 400 });
    }
    const sql = p.sql().strings.join('?');
    for (const fragment of ['"versionHistorial" = 1', 'historial_detalle_valido', '"eliminadoEn" IS NULL', '"proyectoOrigenId"', '"proyectoDestinoId"', '"accion" = \'ELIMINADO\'', 'r."creadoEn" >=', 'r."creadoEn" <', 'ORDER BY r."creadoEn" DESC, r."id" DESC LIMIT']) expect(sql).toContain(fragment);
    expect(sql).not.toMatch(/OFFSET/i);
  });
});
