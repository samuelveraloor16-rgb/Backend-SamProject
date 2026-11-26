import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomInt, randomUUID } from 'crypto';
import type { DispositivoPublico, DispositivoRepository, PlataformaPush } from '../../dominio/puertos/dispositivo.repository';
import { PrismaService } from '../prisma/prisma.service';

const seleccion = { id: true, plataforma: true, creadoEn: true, actualizadoEn: true, ultimoEnvioEn: true } as const;
const columnas = Prisma.sql`"id", "plataforma", "creadoEn", "actualizadoEn", "ultimoEnvioEn"`;
const hash = (codigo: string) => createHash('sha256').update(codigo).digest('hex');

@Injectable()
export class PrismaDispositivoRepository implements DispositivoRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async consultar<T>(sql: Prisma.Sql): Promise<T[]> {
    try {
      return await this.prisma.$queryRaw<T[]>(sql);
    } catch {
      // Ni propagar cause/stack del driver: podrían contener token, código o hash.
      throw new ServiceUnavailableException('No se pudo persistir el dispositivo');
    }
  }

  async registrar(usuarioId: string, token: string, plataforma: PlataformaPush) {
    // Una sentencia: ni carrera find/create ni apropiación por upsert de token ajeno.
    const filas = await this.consultar<DispositivoPublico & { creado: boolean }>(Prisma.sql`
      INSERT INTO "dispositivos" ("id", "usuarioId", "plataforma", "tokenPush", "tokenVersionVinculado", "actualizadoEn")
      SELECT ${randomUUID()}, "id", ${plataforma}::"PlataformaDispositivo", ${token}, "tokenVersion", (clock_timestamp() AT TIME ZONE 'UTC')
      FROM "usuarios" WHERE "id" = ${usuarioId}
      ON CONFLICT ("tokenPush") DO UPDATE SET
        "plataforma" = EXCLUDED."plataforma", "tokenVersionVinculado" = EXCLUDED."tokenVersionVinculado",
        "actualizadoEn" = GREATEST(EXCLUDED."actualizadoEn", "dispositivos"."actualizadoEn" + interval '1 millisecond')
      WHERE "dispositivos"."usuarioId" = EXCLUDED."usuarioId"
      RETURNING ${columnas}, (xmax = 0) AS "creado"`);
    if (!filas[0]) throw new ConflictException('No se pudo registrar el dispositivo');
    const { creado, ...dispositivo } = filas[0];
    return { dispositivo, creado };
  }

  async listar(usuarioId: string, page: number, pageSize: number) {
    const [datos, total] = await this.prisma.$transaction([
      this.prisma.dispositivo.findMany({ where: { usuarioId }, select: seleccion, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.dispositivo.count({ where: { usuarioId } }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { datos, total };
  }

  async revocar(usuarioId: string, id: string) {
    return (await this.prisma.dispositivo.deleteMany({ where: { id, usuarioId } })).count === 1;
  }

  async emitirCodigo(usuarioId: string, id: string) {
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
    const codigo = Array.from({ length: 8 }, () => alfabeto[randomInt(alfabeto.length)]).join('');
    const filas = await this.consultar<{ expiraEn: Date }>(Prisma.sql`
      UPDATE "dispositivos" SET "codigoTransferenciaHash" = ${hash(codigo)},
        "codigoTransferenciaExpiraEn" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '5 minutes',
        "actualizadoEn" = GREATEST((clock_timestamp() AT TIME ZONE 'UTC'), "actualizadoEn" + interval '1 millisecond')
      WHERE "id" = ${id} AND "usuarioId" = ${usuarioId}
      RETURNING "codigoTransferenciaExpiraEn" AS "expiraEn"`);
    return filas[0] ? { codigo, expiraEn: filas[0].expiraEn } : null;
  }

  async transferir(usuarioId: string, codigo: string, token: string) {
    // UPDATE toma el lock de fila y reevalúa el predicado tras esperar: un solo
    // consumidor puede usar el hash. Reasignación y consumo son indivisibles.
    const filas = await this.consultar<DispositivoPublico>(Prisma.sql`
      UPDATE "dispositivos" SET "usuarioId" = ${usuarioId},
        "tokenVersionVinculado" = (SELECT "tokenVersion" FROM "usuarios" WHERE "id" = ${usuarioId}),
        "codigoTransferenciaHash" = NULL, "codigoTransferenciaExpiraEn" = NULL,
        "actualizadoEn" = GREATEST((clock_timestamp() AT TIME ZONE 'UTC'), "actualizadoEn" + interval '1 millisecond')
      WHERE "tokenPush" = ${token} AND "codigoTransferenciaHash" = ${hash(codigo)}
        AND "codigoTransferenciaExpiraEn" > (clock_timestamp() AT TIME ZONE 'UTC')
        AND EXISTS (SELECT 1 FROM "usuarios" WHERE "id" = ${usuarioId})
      RETURNING ${columnas}`);
    return filas[0] ?? null;
  }
}
