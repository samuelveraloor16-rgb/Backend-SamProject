import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { HistorialRepository, RecursoHistorial } from '../../dominio/puertos/historial.repository';
import { PrismaService } from '../prisma/prisma.service';
import { CursorHistorialCodec } from './cursor';
import { conErroresTransitorios } from '../prisma/errores-transitorios';

type Fila = { id: string; entidad: string; entidadId: string; accion: string; detalle: Record<string, unknown>; usuarioId: string | null; actorTipo: string; creadoEn: Date };
@Injectable()
export class PrismaHistorialRepository implements HistorialRepository {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  async listar(tipo: RecursoHistorial, id: string, usuarioId: string, query: Record<string, unknown>, body?: unknown) {
    return conErroresTransitorios(() => this.prisma.$transaction(async tx => {
      // ReadCommitted: la consulta posterior al lock ve los commits por los que
      // esperamos. No adquirir locks de recursos después del fence (inversión).
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(151613)`;
      const recurso = tipo === 'PROYECTO'
        ? await tx.proyecto.findFirst({ where: { id, eliminadoEn: null, espacio: { membresias: { some: { usuarioId } } } }, select: { espacioId: true } })
        : await tx.tarea.findFirst({ where: { id, proyecto: { eliminadoEn: null, espacio: { membresias: { some: { usuarioId } } } } }, select: { proyecto: { select: { espacioId: true } } } }).then(t => t ? { espacioId: t.proyecto.espacioId } : null);
      if (!recurso) throw new NotFoundException('Recurso no encontrado');
      // Revalida y mantiene membresía durante esta página. SHARE es compatible
      // con escritores; no se bloquean proyectos/tareas después del fence.
      const membresia = await tx.$queryRaw<{usuarioId: string}[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${recurso.espacioId} AND "usuarioId" = ${usuarioId} FOR SHARE`;
      if (!membresia.length) throw new NotFoundException('Recurso no encontrado');
      if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) throw new BadRequestException('Consulta inválida');
      if (Object.keys(query).some(k => !['limite', 'cursor'].includes(k))) throw new BadRequestException('Consulta inválida');
      const raw = query.limite ?? '20';
      if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw) || Number(raw) > 100) throw new BadRequestException('Límite inválido');
      const limite = Number(raw);
      if (query.cursor !== undefined && (typeof query.cursor !== 'string' || !query.cursor)) throw new BadRequestException('Cursor inválido');
      const codec = new CursorHistorialCodec(this.config.get<string>('HISTORIAL_CURSOR_SECRET'));
      const scope = JSON.stringify([tipo, id, recurso.espacioId, usuarioId, limite]);
      const [reloj] = await tx.$queryRaw<{ahora: Date}[]>`SELECT clock_timestamp() AS ahora`;
      const ahora = reloj!.ahora;
      const cursor = query.cursor ? codec.decode(query.cursor as string, scope) : null;
      const corte = cursor ? new Date(cursor.corte) : ahora;
      const minimo = new Date(ahora.getTime() - 180 * 86400000);
      if (corte < minimo || corte > ahora) throw new BadRequestException('Cursor inválido');
      // Sin configuración se falla cerrado también con página vacía.
      codec.encode({ v: 1, scope, corte: corte.toISOString(), fecha: corte.toISOString(), id: '_' });
      const contexto = tipo === 'TAREA' ? Prisma.sql`r."tareaId" = ${id}`
        : Prisma.sql`(r."proyectoId" = ${id} OR r."proyectoOrigenId" = ${id} OR r."proyectoDestinoId" = ${id})`;
      const despues = cursor ? Prisma.sql`AND (r."creadoEn", r."id") < ((${new Date(cursor.fecha)}::timestamptz AT TIME ZONE 'UTC'), ${cursor.id})` : Prisma.empty;
      const filas = await tx.$queryRaw<Fila[]>(Prisma.sql`
        SELECT r."id", r."entidad", r."entidadId", r."accion", r."detalle", r."usuarioId", r."actorTipo", r."creadoEn"
        FROM "registro_de_cambios" r
        WHERE r."versionHistorial" = 1 AND r."espacioId" = ${recurso.espacioId} AND ${contexto}
        AND r."creadoEn" >= (${minimo}::timestamptz AT TIME ZONE 'UTC') AND r."creadoEn" < (${corte}::timestamptz AT TIME ZONE 'UTC') ${despues}
        AND r."entidad" IN ('PROYECTO', 'TAREA') AND r."actorTipo" IN ('USUARIO', 'SISTEMA')
        AND (r."actorTipo" <> 'SISTEMA' OR r."usuarioId" IS NULL)
        AND historial_detalle_valido(r."accion", r."detalle")
        AND ((r."entidad" = 'PROYECTO' AND r."entidadId" = r."proyectoId" AND r."tareaId" IS NULL)
          OR (r."entidad" = 'TAREA' AND r."entidadId" = r."tareaId"))
        AND EXISTS (SELECT 1 FROM "proyectos" p WHERE p."id" = r."proyectoId" AND p."espacioId" = r."espacioId" AND p."eliminadoEn" IS NULL)
        AND (r."tareaId" IS NULL OR EXISTS (SELECT 1 FROM "tareas" t JOIN "proyectos" p ON p."id" = t."proyectoId" WHERE t."id" = r."tareaId" AND p."espacioId" = r."espacioId" AND p."eliminadoEn" IS NULL) OR (r."accion" = 'ELIMINADO' AND NOT EXISTS (SELECT 1 FROM "tareas" t WHERE t."id" = r."tareaId")))
        AND (r."accion" <> 'MOVIDO' OR (r."detalle"->>'proyectoOrigenId' = r."proyectoOrigenId" AND r."detalle"->>'proyectoDestinoId' = r."proyectoDestinoId"
          AND EXISTS (SELECT 1 FROM "proyectos" p WHERE p."id" = r."proyectoOrigenId" AND p."espacioId" = r."espacioId" AND p."eliminadoEn" IS NULL)
          AND EXISTS (SELECT 1 FROM "proyectos" p WHERE p."id" = r."proyectoDestinoId" AND p."espacioId" = r."espacioId" AND p."eliminadoEn" IS NULL)))
        ORDER BY r."creadoEn" DESC, r."id" DESC LIMIT ${limite + 1}`);
      const pagina = filas.slice(0, limite);
      const datos = pagina.map(r => ({ id: r.id, entidad: r.entidad, entidadId: r.entidadId, accion: r.accion,
        actor: { tipo: r.actorTipo, id: r.usuarioId }, creadoEn: r.creadoEn.toISOString(), detalle: r.detalle }));
      const ultimo = pagina.at(-1);
      return { datos, meta: { limite, siguienteCursor: filas.length > limite && ultimo ? codec.encode({ v: 1, scope, corte: corte.toISOString(), fecha: ultimo.creadoEn.toISOString(), id: ultimo.id }) : null } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
}
