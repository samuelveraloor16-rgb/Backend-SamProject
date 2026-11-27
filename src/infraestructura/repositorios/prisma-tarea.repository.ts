import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  TareaRepository,
  TareaCompleta,
  DatosCrearTarea,
  DatosActualizarTarea,
  FiltrosTareas,
  EstadoTarea,
  PrioridadTarea,
  RangoCalendarioConsulta,
} from '../../dominio/puertos/tarea.repository';
import { inicioDelDia } from '../../dominio/metricas/progreso';
import { resolverTransicion } from '../../dominio/metricas/historial-finalizaciones';
import { PrismaService } from '../prisma/prisma.service';
import { conErroresTransitorios } from '../prisma/errores-transitorios';
import { randomUUID } from 'crypto';
import { PrismaPushOutboxRepository } from './prisma-push-outbox.repository';
import { registrarAviso } from './prisma-inapp.repository';
import { registrarEventoFinalizacion } from './prisma-eventos-finalizacion';

// Solo se reintenta una transacción que abandonamos explícitamente antes de escribir.
class UbicacionCambio extends Error {}

const INCLUDE_COMPLETA = {
  responsable: { select: { id: true, nombre: true, email: true } },
  etiquetas: { include: { etiqueta: { select: { id: true, nombre: true, color: true } } } },
  _count: { select: { subtareas: true } },
} as const;

type FilaCompleta = {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: string;
  prioridad: string;
  fechaLimite: Date | null;
  fechaFinalizacion: Date | null;
  proyectoId: string;
  responsableId: string | null;
  tareaPadreId: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
  responsable: { id: string; nombre: string; email: string } | null;
  etiquetas: { etiqueta: { id: string; nombre: string; color: string | null } }[];
  _count: { subtareas: number };
};

function aCompleta(t: FilaCompleta): TareaCompleta {
  return {
    id: t.id,
    titulo: t.titulo,
    descripcion: t.descripcion,
    estado: t.estado as EstadoTarea,
    prioridad: t.prioridad as PrioridadTarea,
    fechaLimite: t.fechaLimite,
    fechaFinalizacion: t.fechaFinalizacion,
    proyectoId: t.proyectoId,
    responsableId: t.responsableId,
    tareaPadreId: t.tareaPadreId,
    creadoEn: t.creadoEn,
    actualizadoEn: t.actualizadoEn,
    responsable: t.responsable,
    etiquetas: t.etiquetas.map((e) => e.etiqueta),
    totalSubtareas: t._count.subtareas,
  };
}

/** RF-18: WHERE del calendario — sin subtareas, proyectos NO archivados del espacio (la Bandeja se incluye). Exportado para tests. */
export function construirWhereCalendario(
  espacioId: string,
  rango: RangoCalendarioConsulta,
): Prisma.TareaWhereInput {
  return {
    tareaPadreId: null,
    proyecto: { espacioId, archivado: false },
    // Con ambos extremos abiertos se exige al menos fechaLimite presente: una tarea sin
    // fecha límite no tiene lugar en un calendario.
    ...(rango.desde || rango.hasta
      ? {
          fechaLimite: {
            ...(rango.desde ? { gte: rango.desde } : {}),
            ...(rango.hasta ? { lte: rango.hasta } : {}),
          },
        }
      : { fechaLimite: { not: null } }),
  };
}

@Injectable()
export class PrismaTareaRepository implements TareaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Proyecto antes que tarea, usuarios antes que membresías: mismo orden RF19.
   * Los locks se conservan hasta el commit conjunto con el outbox. */
  private async autorizar(tx: Prisma.TransactionClient, espacioId: string, usuarioId: string, responsableId?: string | null) {
    const usuarios = [...new Set([usuarioId, ...(responsableId ? [responsableId] : [])])].sort();
    for (const id of usuarios) await tx.$queryRaw`SELECT "id" FROM "usuarios" WHERE "id" = ${id} FOR KEY SHARE`;
    const miembros = await tx.$queryRaw<{ usuarioId: string }[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${espacioId} AND "usuarioId" = ANY(${usuarios}) ORDER BY "usuarioId" FOR SHARE`;
    const ids = new Set(miembros.map(m => m.usuarioId));
    if (!ids.has(usuarioId)) throw new NotFoundException('Tarea no encontrada');
    if (responsableId && !ids.has(responsableId)) throw new BadRequestException('El responsable no es miembro del espacio');
  }

  private async encolarAsignacion(tx: Prisma.TransactionClient, tareaId: string, anterior: string | null, nuevo: string | null | undefined, usuarioId: string) {
    if (!nuevo || nuevo === anterior || nuevo === usuarioId) return;
    // Una identidad por cambio confirmado, no por tarea/usuario: A→B→A son eventos distintos.
    // La exclusión mutua de la tarea decide si un PATCH concurrente es realmente un cambio.
    const evento = {
      claveUnica: `asig:${randomUUID()}`, usuarioId: nuevo, tipo: 'TAREA_ASIGNADA', tareaId, comentarioId: null,
    } as const;
    await registrarAviso(tx, evento);
    await new PrismaPushOutboxRepository(this.prisma).enTransaccion(tx).encolar(evento);
  }

  private async conUbicacionActual<T>(tareaId: string, usuarioId: string, operacion: () => Promise<T>): Promise<T> {
    return conErroresTransitorios(async () => {
      for (let intento = 0; intento < 3; intento++) {
        try { return await operacion(); }
        catch (error) {
          if (!(error instanceof UbicacionCambio)) throw error;
          if (intento < 2) continue;
          const visible = await this.prisma.tarea.findFirst({ where: { id: tareaId, proyecto: { espacio: { membresias: { some: { usuarioId } } } } }, select: { id: true } });
          if (!visible) throw new NotFoundException('Tarea no encontrada');
          throw new ServiceUnavailableException('Servicio temporalmente no disponible; reintente');
        }
      }
      throw new ServiceUnavailableException('Servicio temporalmente no disponible; reintente');
    });
  }

  async listarCalendario(
    espacioId: string,
    rango: RangoCalendarioConsulta,
  ): Promise<TareaCompleta[]> {
    const filas = await this.prisma.tarea.findMany({
      where: construirWhereCalendario(espacioId, rango),
      include: INCLUDE_COMPLETA,
    });
    return filas.map((f) => aCompleta(f as FilaCompleta));
  }

  async listar(proyectoId: string, filtros: FiltrosTareas): Promise<TareaCompleta[]> {
    const hoy = inicioDelDia();
    const where: Prisma.TareaWhereInput = {
      proyectoId,
      ...(filtros.estado ? { estado: filtros.estado } : {}),
      ...(filtros.prioridad ? { prioridad: filtros.prioridad } : {}),
      ...(filtros.responsableId ? { responsableId: filtros.responsableId } : {}),
      ...(filtros.q
        ? {
            OR: [
              { titulo: { contains: filtros.q, mode: 'insensitive' } },
              { descripcion: { contains: filtros.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(filtros.vencidas ? { fechaLimite: { lt: hoy }, estado: { not: 'HECHA' } } : {}),
    };
    const filas = await this.prisma.tarea.findMany({
      where,
      include: INCLUDE_COMPLETA,
    });
    return filas.map((f) => aCompleta(f as FilaCompleta));
  }

  async buscarPorId(id: string): Promise<TareaCompleta | null> {
    const t = await this.prisma.tarea.findUnique({
      where: { id },
      include: INCLUDE_COMPLETA,
    });
    return t ? aCompleta(t as FilaCompleta) : null;
  }

  async listarSubtareas(padreId: string): Promise<TareaCompleta[]> {
    const filas = await this.prisma.tarea.findMany({
      where: { tareaPadreId: padreId },
      include: INCLUDE_COMPLETA,
      orderBy: { creadoEn: 'asc' },
    });
    return filas.map((f) => aCompleta(f as FilaCompleta));
  }

  crear(datos: DatosCrearTarea, usuarioId: string): Promise<TareaCompleta> {
    return this.prisma.$transaction(async (tx) => {
      const proyectos = await tx.$queryRaw<{ espacioId: string; archivado: boolean }[]>`SELECT "espacioId", "archivado" FROM "proyectos" WHERE "id" = ${datos.proyectoId} FOR SHARE`;
      if (!proyectos[0]) throw new NotFoundException('Proyecto no encontrado');
      await this.autorizar(tx, proyectos[0].espacioId, usuarioId, datos.responsableId);
      if (proyectos[0].archivado) throw new BadRequestException('El proyecto está archivado');
      const creada = await tx.tarea.create({
        data: {
          titulo: datos.titulo,
          descripcion: datos.descripcion ?? null,
          prioridad: datos.prioridad,
          fechaLimite: datos.fechaLimite ?? null,
          responsableId: datos.responsableId ?? null,
          proyectoId: datos.proyectoId,
          tareaPadreId: datos.tareaPadreId ?? null,
        },
      });
      if (datos.etiquetasIds.length > 0) {
        await tx.tareaEtiqueta.createMany({
          data: datos.etiquetasIds.map((etiquetaId) => ({ tareaId: creada.id, etiquetaId })),
          skipDuplicates: true,
        });
      }
      await this.encolarAsignacion(tx, creada.id, null, datos.responsableId, usuarioId);
      const completa = await tx.tarea.findUnique({
        where: { id: creada.id },
        include: INCLUDE_COMPLETA,
      });
      return aCompleta(completa as unknown as FilaCompleta);
    });
  }

  crearSubtareaAutorizada(datos: DatosCrearTarea, usuarioId: string): Promise<TareaCompleta> {
    return this.conUbicacionActual(datos.tareaPadreId!, usuarioId, () => this.prisma.$transaction(async tx => {
      const inicial = await tx.tarea.findUnique({ where: { id: datos.tareaPadreId! }, select: { proyectoId: true } });
      if (!inicial) throw new NotFoundException('Tarea no encontrada');
      const proyectos = await tx.$queryRaw<{ espacioId: string; archivado: boolean }[]>`SELECT "espacioId", "archivado" FROM "proyectos" WHERE "id" = ${inicial.proyectoId} FOR SHARE`;
      if (!proyectos[0]) throw new NotFoundException('Tarea no encontrada');
      const padres = await tx.$queryRaw<{ proyectoId: string; tareaPadreId: string | null }[]>`SELECT "proyectoId", "tareaPadreId" FROM "tareas" WHERE "id" = ${datos.tareaPadreId} FOR UPDATE`;
      if (!padres[0]) throw new NotFoundException('Tarea no encontrada');
      const usuarios = [...new Set([usuarioId, ...(datos.responsableId ? [datos.responsableId] : [])])].sort();
      for (const u of usuarios) await tx.$queryRaw`SELECT "id" FROM "usuarios" WHERE "id" = ${u} FOR KEY SHARE`;
      const miembros = await tx.$queryRaw<{ usuarioId: string }[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${proyectos[0].espacioId} AND "usuarioId" = ANY(${usuarios}) ORDER BY "usuarioId" FOR SHARE`;
      const ids = new Set(miembros.map(m => m.usuarioId));
      if (!ids.has(usuarioId)) throw new NotFoundException('Tarea no encontrada');
      if (padres[0].proyectoId !== inicial.proyectoId) throw new UbicacionCambio();
      if (proyectos[0].archivado) throw new BadRequestException('El proyecto está archivado');
      if (padres[0].tareaPadreId !== null) throw new BadRequestException('Las subtareas no pueden tener subtareas');
      if (datos.responsableId && !ids.has(datos.responsableId)) throw new BadRequestException('El responsable no es miembro del espacio');
      const creada = await tx.tarea.create({ data: { titulo: datos.titulo, descripcion: datos.descripcion ?? null, prioridad: datos.prioridad, fechaLimite: datos.fechaLimite ?? null, responsableId: datos.responsableId ?? null, proyectoId: inicial.proyectoId, tareaPadreId: datos.tareaPadreId }, include: INCLUDE_COMPLETA });
      await this.encolarAsignacion(tx, creada.id, null, datos.responsableId, usuarioId);
      return aCompleta(creada as FilaCompleta);
    }));
  }

  actualizar(id: string, datos: DatosActualizarTarea, usuarioId: string): Promise<TareaCompleta> {
    return this.conUbicacionActual(id, usuarioId, () => this.prisma.$transaction(async (tx) => {
      const inicial = await tx.tarea.findUnique({ where: { id }, select: { proyectoId: true } });
      if (!inicial) throw new NotFoundException('Tarea no encontrada');
      const proyectos = await tx.$queryRaw<{ espacioId: string; archivado: boolean }[]>`SELECT "espacioId", "archivado" FROM "proyectos" WHERE "id" = ${inicial.proyectoId} FOR SHARE`;
      if (!proyectos[0]) throw new NotFoundException('Tarea no encontrada');
      const filas = await tx.$queryRaw<{ proyectoId: string; responsableId: string | null }[]>`SELECT "proyectoId", "responsableId" FROM "tareas" WHERE "id" = ${id} FOR UPDATE`;
      if (!filas[0]) throw new NotFoundException('Tarea no encontrada');
      await this.autorizar(tx, proyectos[0].espacioId, usuarioId, datos.responsableId);
      if (filas[0].proyectoId !== inicial.proyectoId) throw new UbicacionCambio();
      if (proyectos[0].archivado) throw new BadRequestException('El proyecto está archivado');
      const data: Record<string, unknown> = {};
      if (datos.titulo !== undefined && datos.titulo !== null) data.titulo = datos.titulo;
      if (datos.descripcion !== undefined) data.descripcion = datos.descripcion;
      if (datos.prioridad !== undefined) data.prioridad = datos.prioridad;
      if (datos.fechaLimite !== undefined) data.fechaLimite = datos.fechaLimite;
      if (datos.responsableId !== undefined) data.responsableId = datos.responsableId;

      if (Object.keys(data).length > 0) {
        await tx.tarea.update({ where: { id }, data });
      }
      await this.encolarAsignacion(tx, id, filas[0].responsableId, datos.responsableId, usuarioId);
      if (datos.etiquetasIds !== undefined) {
        await tx.tareaEtiqueta.deleteMany({ where: { tareaId: id } });
        if (datos.etiquetasIds.length > 0) {
          await tx.tareaEtiqueta.createMany({
            data: datos.etiquetasIds.map((etiquetaId) => ({ tareaId: id, etiquetaId })),
            skipDuplicates: true,
          });
        }
      }
      const completa = await tx.tarea.findUnique({
        where: { id },
        include: INCLUDE_COMPLETA,
      });
      return aCompleta(completa as unknown as FilaCompleta);
    }));
  }

  cambiarEstado(id: string, estado: EstadoTarea, usuarioId: string): Promise<TareaCompleta> {
    return this.conUbicacionActual(id, usuarioId, () => this.prisma.$transaction(async (tx) => {
      const inicial = await tx.tarea.findUnique({ where: { id }, select: { proyectoId: true } });
      if (!inicial) throw new NotFoundException('Tarea no encontrada');
      const proyectos = await tx.$queryRaw<{ espacioId: string; archivado: boolean }[]>`SELECT "espacioId", "archivado" FROM "proyectos" WHERE "id" = ${inicial.proyectoId} FOR SHARE`;
      if (!proyectos[0]) throw new NotFoundException('Tarea no encontrada');
      const filas = await tx.$queryRaw<{ proyectoId: string; estado: EstadoTarea }[]>`SELECT "proyectoId", "estado" FROM "tareas" WHERE "id" = ${id} FOR UPDATE`;
      if (!filas[0]) throw new NotFoundException('Tarea no encontrada');
      await this.autorizar(tx, proyectos[0].espacioId, usuarioId);
      if (filas[0].proyectoId !== inicial.proyectoId) throw new UbicacionCambio();
      if (proyectos[0].archivado) throw new BadRequestException('El proyecto está archivado');

      const estadoAnterior = filas[0].estado;
      const efecto = resolverTransicion(estadoAnterior, estado);
      if (efecto.tipo === null && estadoAnterior === estado) {
        // HECHA→HECHA (y cualquier mismo estado): no se escribe ni se registra nada.
        const actual = await tx.tarea.findUnique({ where: { id }, include: INCLUDE_COMPLETA });
        return aCompleta(actual as unknown as FilaCompleta);
      }

      // Fotografía RF11 bajo el lock del padre: las altas de subtareas necesitan
      // ese mismo FOR UPDATE y los borrados esperan al FOR SHARE de las hijas.
      const hijos = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "tareas" WHERE "tareaPadreId" = ${id} ORDER BY "id" FOR SHARE`;

      let ocurridoEn: Date | null = null;
      if (efecto.tipo !== null) {
        const reloj = await tx.$queryRaw<{ ahora: Date }[]>`SELECT clock_timestamp() AS "ahora"`;
        ocurridoEn = reloj[0]!.ahora;
      }

      const data: Prisma.TareaUpdateInput = { estado };
      if (efecto.fechaFinalizacion === 'ESTABLECER') data.fechaFinalizacion = ocurridoEn!;
      if (efecto.fechaFinalizacion === 'LIMPIAR') data.fechaFinalizacion = null;
      await tx.tarea.update({ where: { id }, data });

      if (efecto.tipo !== null && ocurridoEn !== null) {
        // Misma transacción: si el registro falla, el UPDATE anterior revierte.
        await registrarEventoFinalizacion(tx, {
          tareaId: id,
          proyectoId: filas[0].proyectoId,
          estadoAnterior,
          estadoNuevo: estado,
          tipo: efecto.tipo,
          usuarioId,
          contable: hijos.length === 0,
          ocurridoEn,
        });
      }

      const completa = await tx.tarea.findUnique({ where: { id }, include: INCLUDE_COMPLETA });
      return aCompleta(completa as unknown as FilaCompleta);
    }));
  }

  async eliminar(id: string): Promise<void> {
    // ON DELETE CASCADE: subtareas (tareaPadreId), comentarios, adjuntos, tarea_etiquetas.
    await this.prisma.tarea.delete({ where: { id } });
  }

  async moverConSubtareas(tareaId: string, destinoProyectoId: string, usuarioId: string): Promise<TareaCompleta> {
    return this.conUbicacionActual(tareaId, usuarioId, () => this.prisma.$transaction(async tx => {
      const inicial = await tx.tarea.findUnique({ where: { id: tareaId }, select: { proyectoId: true } });
      if (!inicial) throw new NotFoundException('Tarea no encontrada');
      const proyectos = new Map<string, { espacioId: string; archivado: boolean }>();
      for (const id of [...new Set([inicial.proyectoId, destinoProyectoId])].sort()) {
        const filas = await tx.$queryRaw<{ espacioId: string; archivado: boolean }[]>`SELECT "espacioId", "archivado" FROM "proyectos" WHERE "id" = ${id} FOR SHARE`;
        if (!filas[0]) throw new NotFoundException('Proyecto no encontrado');
        proyectos.set(id, filas[0]);
      }
      const filas = await tx.$queryRaw<{ proyectoId: string; tareaPadreId: string | null }[]>`SELECT "proyectoId", "tareaPadreId" FROM "tareas" WHERE "id" = ${tareaId} FOR UPDATE`;
      if (!filas[0]) throw new NotFoundException('Tarea no encontrada');
      const origen = proyectos.get(inicial.proyectoId)!;
      const destino = proyectos.get(destinoProyectoId)!;
      await tx.$queryRaw`SELECT "id" FROM "usuarios" WHERE "id" = ${usuarioId} FOR KEY SHARE`;
      for (const espacioId of [...new Set([origen.espacioId, destino.espacioId])].sort()) {
        const membresia = await tx.$queryRaw<{ usuarioId: string }[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${espacioId} AND "usuarioId" = ${usuarioId} FOR SHARE`;
        if (!membresia.length) throw new NotFoundException('Proyecto no encontrado');
      }
      if (filas[0].proyectoId !== inicial.proyectoId) throw new UbicacionCambio();
      if (origen.espacioId !== destino.espacioId) throw new BadRequestException('No se puede mover entre espacios distintos');
      if (origen.archivado || destino.archivado) throw new BadRequestException('El proyecto está archivado');
      if (inicial.proyectoId !== destinoProyectoId) {
        if (filas[0].tareaPadreId !== null) throw new BadRequestException('No se puede mover una subtarea independientemente');
        await tx.tarea.update({ where: { id: tareaId }, data: { proyectoId: destinoProyectoId } });
        await tx.tarea.updateMany({ where: { tareaPadreId: tareaId }, data: { proyectoId: destinoProyectoId } });
      }
      // El padre bloqueado impide altas; bloquear las hijas existentes evita que
      // una eliminación concurrente cambie el conteo antes del commit, también en no-op.
      await tx.$queryRaw`SELECT "id" FROM "tareas" WHERE "tareaPadreId" = ${tareaId} ORDER BY "id" FOR SHARE`;
      const completa = await tx.tarea.findUniqueOrThrow({ where: { id: tareaId }, include: INCLUDE_COMPLETA });
      return aCompleta(completa as FilaCompleta);
    }));
  }
}
