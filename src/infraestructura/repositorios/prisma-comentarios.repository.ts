import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { envelope } from '../../aplicacion/comun/paginacion';
import type { ComentariosRepository } from '../../dominio/puertos/comentarios.repository';
import { PrismaService } from '../prisma/prisma.service';
import { conErroresTransitorios } from '../prisma/errores-transitorios';
import { clavesComentario, nuevaHuella, verificarHuella } from '../seguridad/huella-comentario';
import { PrismaPushOutboxRepository } from './prisma-push-outbox.repository';

type Tx = Prisma.TransactionClient;
const marcadorPendiente = new Date('9999-12-31T23:59:59.000Z');
async function bloquearClave(tx: Tx, usuarioId: string, clave: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([usuarioId, clave])}, 0))::text`;
}
const comentarioInclude = { autor: { select: { id: true, nombre: true } }, menciones: { orderBy: { posicion: 'asc' }, include: { usuario: { select: { id: true, nombre: true } } } } } as const;
type Comentario = Prisma.ComentarioGetPayload<{ include: typeof comentarioInclude }>;
function publico(c: Comentario) {
  return { id: c.id, tareaId: c.tareaId, texto: c.texto, autor: c.autor, menciones: c.menciones.map(m => m.usuario), creadoEn: c.creadoEn, actualizadoEn: c.actualizadoEn };
}
const avisoInclude = { comentario: { include: { tarea: { include: { proyecto: true } } } } } as const;
type Aviso = Prisma.NotificacionGetPayload<{ include: typeof avisoInclude }>;
function aviso(n: Aviso) {
  const c = n.comentario!;
  return { id: n.id, tipo: n.tipo, titulo: n.titulo, cuerpo: n.cuerpo, leida: n.leida, datos: { espacioId: c.tarea.proyecto.espacioId, proyectoId: c.tarea.proyectoId, tareaId: c.tarea.id, comentarioId: c.id }, creadoEn: n.creadoEn };
}

/** Los locks de fila SHARE chocan con DELETE/UPDATE normales ya usados por RF anteriores. */
async function bloquearTarea(tx: Tx, tareaId: string, usuarioId: string, destinatarios: string[] = []) {
  // Proyecto primero: el borrado de proyecto toma el mismo orden al ejecutar su cascada.
  const tareas = await tx.$queryRaw<{ proyectoId: string }[]>`SELECT "proyectoId" FROM "tareas" WHERE "id" = ${tareaId}`;
  if (!tareas[0]) throw new NotFoundException('Tarea no encontrada');
  const proyectos = await tx.$queryRaw<{ espacioId: string; archivado: boolean }[]>`SELECT "espacioId", "archivado" FROM "proyectos" WHERE "id" = ${tareas[0].proyectoId} FOR SHARE`;
  if (!proyectos[0]) throw new NotFoundException('Tarea no encontrada');
  const bloqueadas = await tx.$queryRaw<{ proyectoId: string; responsableId: string | null }[]>`SELECT "proyectoId", "responsableId" FROM "tareas" WHERE "id" = ${tareaId} FOR SHARE`;
  if (!bloqueadas[0]) throw new NotFoundException('Tarea no encontrada');
  if (bloqueadas[0].proyectoId !== tareas[0].proyectoId) throw new ServiceUnavailableException('La tarea se movió; reintente');
  // Bajas físicas bloquean primero usuarios y después sus membresías (cascada).
  // Tomar KEY SHARE antes de membresías evita inversión de orden con esos deletes.
  const responsableId = bloqueadas[0].responsableId;
  for (const id of [...new Set([usuarioId, ...destinatarios, ...(responsableId ? [responsableId] : [])])].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "usuarios" WHERE "id" = ${id} FOR KEY SHARE`;
  }
  const miembros = await tx.$queryRaw<{ usuarioId: string }[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${proyectos[0].espacioId} AND "usuarioId" = ${usuarioId} FOR SHARE`;
  if (!miembros.length) throw new NotFoundException('Tarea no encontrada');
  return { ...proyectos[0], responsableId };
}
async function visible(tx: Tx, tareaId: string, usuarioId: string) {
  const t = await tx.tarea.findFirst({ where: { id: tareaId, proyecto: { espacio: { membresias: { some: { usuarioId } } } } }, select: { proyecto: { select: { espacioId: true } } } });
  if (!t) throw new NotFoundException('Tarea no encontrada');
  return t.proyecto.espacioId;
}
function whereAviso(usuarioId: string, leida?: boolean): Prisma.NotificacionWhereInput {
  return { usuarioId, tipo: 'MENCION', ...(leida === undefined ? {} : { leida }), comentario: { is: { menciones: { some: { usuarioId } }, tarea: { proyecto: { espacio: { membresias: { some: { usuarioId } } } } } } } };
}

@Injectable()
export class PrismaComentariosRepository implements ComentariosRepository {
  private readonly logger = new Logger(PrismaComentariosRepository.name);
  constructor(private readonly prisma: PrismaService) {}

  async crear(tareaId: string, usuarioId: string, texto: string, clave: string, menciones: string[]) {
    const config = clavesComentario();
    const huella = nuevaHuella(config, tareaId, texto);
    const resultado = await conErroresTransitorios(() => this.prisma.$transaction(async tx => {
        await bloquearClave(tx, usuarioId, clave);
        const anterior = await tx.idempotenciaComentario.findUnique({ where: { usuarioId_clave: { usuarioId, clave } } });
        const [{ ahora }] = await tx.$queryRaw<[{ ahora: Date }]>`SELECT clock_timestamp() AS ahora`;
        if (anterior && anterior.expiraEn > ahora) {
          // No se filtra información de recursos sin acceso, incluso en caso de colisión.
          await bloquearTarea(tx, tareaId, usuarioId);
          const verificacion = verificarHuella(anterior.huella, config, tareaId, texto);
          if (!verificacion.coincide) throw new ConflictException('Clave reutilizada con otra petición');
          if (verificacion.legacy) await tx.idempotenciaComentario.update({ where: { usuarioId_clave: { usuarioId, clave } }, data: { huella } });
          if (!anterior.comentarioId) return { comentario: null, replay: true, generacion: anterior.generacion };
          const c = await tx.comentario.findUnique({ where: { id: anterior.comentarioId }, include: comentarioInclude });
          if (!c || c.tareaId !== tareaId) return { comentario: null, replay: true, generacion: anterior.generacion };
          return { comentario: publico(c), replay: true, generacion: anterior.generacion };
        }
        if (anterior) await tx.idempotenciaComentario.delete({ where: { usuarioId_clave: { usuarioId, clave } } });
        const proyecto = await bloquearTarea(tx, tareaId, usuarioId, menciones);
        if (proyecto.archivado) throw new BadRequestException('El proyecto está archivado');
        // Orden estable para reducir deadlocks con publicaciones concurrentes.
        for (const id of [...menciones].sort()) {
          const rows = await tx.$queryRaw<{ usuarioId: string }[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${proyecto.espacioId} AND "usuarioId" = ${id} FOR SHARE`;
          if (!rows.length) throw new BadRequestException('Uno o más destinatarios no son válidos');
        }
        const c = await tx.comentario.create({ data: { tareaId, autorId: usuarioId, texto, menciones: { create: menciones.map((id, posicion) => ({ usuarioId: id, posicion })) }, notificaciones: { create: menciones.filter(id => id !== usuarioId).map(id => ({ usuarioId: id, tipo: 'MENCION', titulo: 'Te mencionaron' })) } }, include: comentarioInclude });
        // D-21: hasta 20 mencionados + responsable adicional. La tarea SHARE
        // estabiliza la asignación; usuarios se bloquearon antes de membresías.
        const destinatarios = new Set(menciones);
        if (proyecto.responsableId && !destinatarios.has(proyecto.responsableId) && proyecto.responsableId !== usuarioId) {
          const id = proyecto.responsableId;
          const miembros = await tx.$queryRaw<{ usuarioId: string }[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${proyecto.espacioId} AND "usuarioId" = ${id} FOR SHARE`;
          // Responsable histórico que perdió acceso: no impedir el comentario,
          // pero nunca encolar para él. Si fue mencionado, RF19 ya lo rechazó.
          if (miembros.length) destinatarios.add(id);
        }
        destinatarios.delete(usuarioId);
        const outbox = new PrismaPushOutboxRepository(this.prisma).enTransaccion(tx);
        for (const id of [...destinatarios].sort()) {
          await outbox.encolar({ claveUnica: `com:${c.id}:${id}`, usuarioId: id,
            tipo: menciones.includes(id) ? 'MENCION' : 'COMENTARIO', tareaId, comentarioId: c.id });
        }
        // Un marcador sin caducidad inmediata es seguro incluso si el proceso cae antes
        // de recibir confirmación del commit. Se fija la caducidad solo después del commit.
        const generacion = randomUUID();
        await tx.idempotenciaComentario.create({ data: { usuarioId, clave, huella, generacion, comentarioId: c.id, expiraEn: marcadorPendiente } });
        return { comentario: publico(c), replay: false, generacion };
      }, { timeout: 10000, maxWait: 5000 }));
    if (resultado.generacion) {
      // Solo la generación confirmada puede finalizarse, bajo el mismo lock que publicación y limpieza.
      try {
        await this.prisma.$transaction(async tx => {
          await bloquearClave(tx, usuarioId, clave);
          await tx.$executeRaw`UPDATE "idempotencias_comentario" SET "expiraEn" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '24 hours 10 seconds' WHERE "usuarioId" = ${usuarioId} AND "clave" = ${clave} AND "generacion" = ${resultado.generacion} AND "expiraEn" = ${marcadorPendiente}`;
        });
      } catch {
        this.logger.warn('No se pudo fijar la caducidad del marcador confirmado; se conservará para un reintento');
      }
    }
    if (!resultado.comentario) throw new NotFoundException('Comentario no encontrado');
    return { comentario: resultado.comentario, replay: resultado.replay };
  }
  /** Limpieza explícita y acotada: nunca procesa el marcador 9999. */
  async limpiarVencidas(limite = 100): Promise<number> {
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw new BadRequestException('Límite inválido');
    const candidatas = await this.prisma.$queryRaw<{ usuarioId: string; clave: string }[]>`SELECT "usuarioId", "clave" FROM "idempotencias_comentario" WHERE "expiraEn" <= (clock_timestamp() AT TIME ZONE 'UTC') AND "expiraEn" <> ${marcadorPendiente} ORDER BY "expiraEn" LIMIT ${limite}`;
    let eliminadas = 0;
    for (const candidata of candidatas) {
      eliminadas += await conErroresTransitorios(() => this.prisma.$transaction(async tx => {
        await bloquearClave(tx, candidata.usuarioId, candidata.clave);
        return tx.$executeRaw`DELETE FROM "idempotencias_comentario" WHERE "usuarioId" = ${candidata.usuarioId} AND "clave" = ${candidata.clave} AND "expiraEn" <= (clock_timestamp() AT TIME ZONE 'UTC') AND "expiraEn" <> ${marcadorPendiente}`;
      }));
    }
    return eliminadas;
  }
  async listar(tareaId: string, usuarioId: string, page: number, pageSize: number) {
    return conErroresTransitorios(() => this.prisma.$transaction(async tx => {
      await visible(tx, tareaId, usuarioId);
      const where = { tareaId };
      const [total, datos] = await Promise.all([tx.comentario.count({ where }), tx.comentario.findMany({ where, include: comentarioInclude, orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })]);
      return envelope(datos.map(publico), total, page, pageSize);
    }, { isolationLevel: 'RepeatableRead' }));
  }
  async directorio(tareaId: string, usuarioId: string, page: number, pageSize: number, q?: string) {
    return conErroresTransitorios(() => this.prisma.$transaction(async tx => {
      const espacioId = await visible(tx, tareaId, usuarioId);
      const where: Prisma.UsuarioWhereInput = { membresias: { some: { espacioId } }, ...(q ? { nombre: { contains: q, mode: 'insensitive' } } : {}) };
      const todos = await tx.usuario.findMany({ where, select: { id: true, nombre: true } });
      todos.sort((a, b) => a.nombre.toLocaleLowerCase('es').localeCompare(b.nombre.toLocaleLowerCase('es')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return envelope(todos.slice((page - 1) * pageSize, page * pageSize), todos.length, page, pageSize);
    }, { isolationLevel: 'RepeatableRead' }));
  }
  async notificaciones(usuarioId: string, page: number, pageSize: number, leida?: boolean) {
    return conErroresTransitorios(() => this.prisma.$transaction(async tx => {
      const where = whereAviso(usuarioId, leida);
      const [total, datos] = await Promise.all([tx.notificacion.count({ where }), tx.notificacion.findMany({ where, include: avisoInclude, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })]);
      return envelope(datos.map(aviso), total, page, pageSize);
    }, { isolationLevel: 'RepeatableRead' }));
  }
  async leer(id: string, usuarioId: string) {
    return conErroresTransitorios(() => this.prisma.$transaction(async tx => {
      const n = await tx.notificacion.findFirst({ where: { ...whereAviso(usuarioId), id }, include: avisoInclude });
      if (!n?.comentario) throw new NotFoundException('Notificación no encontrada');
      await bloquearTarea(tx, n.comentario.tareaId, usuarioId);
      const actual = await tx.notificacion.updateMany({ where: { ...whereAviso(usuarioId), id }, data: { leida: true } });
      if (!actual.count) throw new NotFoundException('Notificación no encontrada');
      const resultado = await tx.notificacion.findUnique({ where: { id }, include: avisoInclude });
      if (!resultado?.comentario) throw new NotFoundException('Notificación no encontrada');
      return aviso(resultado);
    }));
  }
}
