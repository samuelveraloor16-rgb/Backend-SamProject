import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaDispositivoRepository } from './prisma-dispositivo.repository';
import { PrismaPushOutboxRepository } from './prisma-push-outbox.repository';

describe('RF20 persistencia (mocks, sin conexión BD)', () => {
  const publico = { id: 'd1', plataforma: 'IOS', creadoEn: new Date(), actualizadoEn: new Date(), ultimoEnvioEn: null };
  let db: any;
  let repo: PrismaDispositivoRepository;
  const consulta = () => db.$queryRaw.mock.calls.at(-1)[0] as Prisma.Sql;
  beforeEach(() => {
    db = { $queryRaw: jest.fn(), $transaction: jest.fn(), dispositivo: { findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn() }, pushOutbox: { createMany: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() } };
    repo = new PrismaDispositivoRepository(db as PrismaService);
  });

  it.each([true, false])('registro/refresh devuelve proyección segura, creado=%s', async creado => {
    db.$queryRaw.mockResolvedValue([{ ...publico, creado }]);
    expect(await repo.registrar('u1', 'token-secreto', 'IOS')).toEqual({ dispositivo: publico, creado });
    expect(consulta().text).toContain('ON CONFLICT ("tokenPush") DO UPDATE');
    expect(consulta().text).toContain('"dispositivos"."usuarioId" = EXCLUDED."usuarioId"');
    expect(consulta().text).toContain('"tokenVersionVinculado" = EXCLUDED."tokenVersionVinculado"');
    expect(consulta().text).not.toContain('token-secreto');
  });

  it('token ajeno produce conflicto genérico sin apropiación', async () => {
    db.$queryRaw.mockResolvedValue([]);
    await expect(repo.registrar('otro', 'secreto', 'ANDROID')).rejects.toThrow(new ConflictException('No se pudo registrar el dispositivo'));
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('errores del driver no propagan material secreto ni causa', async () => {
    db.$queryRaw.mockRejectedValue(new Error('fila con token-secreto'));
    try {
      await repo.registrar('u1', 'token-secreto', 'IOS');
      throw new Error('Se esperaba error');
    } catch (error) {
      expect((error as Error).message).toBe('No se pudo persistir el dispositivo');
      expect((error as Error).stack).not.toContain('token-secreto');
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it('listado filtra propietario, pagina y selecciona solo datos públicos', async () => {
    db.$transaction.mockResolvedValue([[publico], 1]);
    expect(await repo.listar('u1', 2, 10)).toEqual({ datos: [publico], total: 1 });
    const args = db.dispositivo.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ where: { usuarioId: 'u1' }, skip: 10, take: 10, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }] });
    expect(Object.keys(args.select).sort()).toEqual(['actualizadoEn', 'creadoEn', 'id', 'plataforma', 'ultimoEnvioEn']);
    expect(db.dispositivo.count).toHaveBeenCalledWith({ where: { usuarioId: 'u1' } });
  });

  it.each([0, 1])('revocación propia atómica, filas=%s (ajeno/inexistente indistinguibles)', async count => {
    db.dispositivo.deleteMany.mockResolvedValue({ count });
    expect(await repo.revocar('u1', 'd1')).toBe(count === 1);
    expect(db.dispositivo.deleteMany).toHaveBeenCalledWith({ where: { id: 'd1', usuarioId: 'u1' } });
  });

  it('emite código criptográfico, almacena solo SHA256 y TTL BD de cinco minutos', async () => {
    const expiraEn = new Date();
    db.$queryRaw.mockResolvedValue([{ expiraEn }]);
    const codigo = await repo.emitirCodigo('u1', 'd1');
    expect(codigo?.codigo).toMatch(/^[A-Z2-9]{8}$/);
    expect(consulta().values).toContain(createHash('sha256').update(codigo!.codigo).digest('hex'));
    expect(consulta().values).not.toContain(codigo!.codigo);
    expect(consulta().text).toContain("interval '5 minutes'");
    expect(consulta().text).toMatch(/WHERE "id" = .* AND "usuarioId" = /);
  });

  it('no emite código de dispositivo ajeno/inexistente', async () => {
    db.$queryRaw.mockResolvedValue([]);
    expect(await repo.emitirCodigo('otro', 'd1')).toBeNull();
  });

  it('transferencia valida token/hash/expiración y consume junto con la reasignación en una sentencia', async () => {
    db.$queryRaw.mockResolvedValue([publico]);
    expect(await repo.transferir('destino', 'ABCDEFG2', 'token')).toEqual(publico);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = consulta();
    expect(sql.text).toContain('UPDATE "dispositivos" SET "usuarioId"');
    expect(sql.text).toContain('"codigoTransferenciaHash" = NULL, "codigoTransferenciaExpiraEn" = NULL');
    expect(sql.text).toContain('WHERE "tokenPush" =');
    expect(sql.text).toContain('AND "codigoTransferenciaHash" =');
    expect(sql.text).toContain('"codigoTransferenciaExpiraEn" > (clock_timestamp()');
    expect(sql.text).toContain('SELECT "tokenVersion" FROM "usuarios"');
    expect(sql.values).not.toContain('ABCDEFG2');
    expect(sql.text.split('RETURNING')[1]).not.toMatch(/tokenPush|codigoTransferencia/);
  });

  it.each(['caducado', 'usado', 'inexistente', 'token distinto'])('transferencia sin coincidencia: %s', async () => {
    db.$queryRaw.mockResolvedValue([]);
    expect(await repo.transferir('u2', 'ABCDEFG2', 'token')).toBeNull();
  });

  it.each([0, 1])('outbox dedup NULL sin abortar transacción, count=%s', async count => {
    const evento = { claveUnica: 'venc24:t:fecha', usuarioId: 'u1', tareaId: 't', tipo: 'TAREA_POR_VENCER' as const, comentarioId: null };
    db.pushOutbox.createMany.mockResolvedValue({ count });
    expect(await new PrismaPushOutboxRepository(db).encolar(evento)).toBe(count === 1);
    expect(db.pushOutbox.createMany).toHaveBeenCalledWith({ data: [evento], skipDuplicates: true });
  });

  it('encolado usa transacción recibida, no cliente global', async () => {
    const tx = { pushOutbox: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    await new PrismaPushOutboxRepository(db).enTransaccion(tx as unknown as Prisma.TransactionClient).encolar({ claveUnica: 'com:c:u', usuarioId: 'u', tareaId: 't', comentarioId: 'c', tipo: 'MENCION' });
    expect(tx.pushOutbox.createMany).toHaveBeenCalledTimes(1);
    expect(db.pushOutbox.createMany).not.toHaveBeenCalled();
  });

  it('almacenamiento acotado y compare-and-set no procesa envíos', async () => {
    const outbox = new PrismaPushOutboxRepository(db);
    await expect(outbox.pendientes(new Date(), 101)).rejects.toThrow(RangeError);
    db.pushOutbox.findMany.mockResolvedValue([]);
    const hasta = new Date();
    await outbox.pendientes(hasta, 10);
    expect(db.pushOutbox.findMany.mock.calls[0][0]).toMatchObject({ where: { estado: 'PENDIENTE', proximoIntentoEn: { lte: hasta } }, take: 10 });
    db.pushOutbox.updateMany.mockResolvedValue({ count: 1 });
    expect(await outbox.actualizar('o1', 0, { estado: 'ENVIADO', intentos: 1 })).toBe(true);
    expect(db.pushOutbox.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', estado: 'PENDIENTE', intentos: 0 }, data: { estado: 'ENVIADO', intentos: 1 } });
  });

  it('inspección estática SQL: unicidad NULL cubierta por clave no nula y comentario por usuario', () => {
    // No afirma ejecución PostgreSQL: solo verifica el artefacto versionado.
    const sql = readFileSync(join(process.cwd(), 'prisma/migrations/20261125120000_rf20_push_persistence/migration.sql'), 'utf8');
    expect(sql).toContain('"claveUnica" TEXT NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX "push_outbox_claveUnica_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "push_outbox_comentarioId_usuarioId_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "dispositivos_tokenPush_key"');
    expect(sql).toContain('CHECK ("intentos" BETWEEN 0 AND 5)');
    expect(sql.match(/ON DELETE CASCADE/g)).toHaveLength(4);
  });
});
