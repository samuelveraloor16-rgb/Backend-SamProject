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
import { PrismaService } from '../prisma/prisma.service';
import { conErroresTransitorios } from '../prisma/errores-transitorios';

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

  crear(datos: DatosCrearTarea): Promise<TareaCompleta> {
    return this.prisma.$transaction(async (tx) => {
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
      return aCompleta(creada as FilaCompleta);
    }));
  }

  actualizar(id: string, datos: DatosActualizarTarea): Promise<TareaCompleta> {
    return this.prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (datos.titulo !== undefined && datos.titulo !== null) data.titulo = datos.titulo;
      if (datos.descripcion !== undefined) data.descripcion = datos.descripcion;
      if (datos.prioridad !== undefined) data.prioridad = datos.prioridad;
      if (datos.fechaLimite !== undefined) data.fechaLimite = datos.fechaLimite;
      if (datos.responsableId !== undefined) data.responsableId = datos.responsableId;
      if (datos.estado !== undefined) data.estado = datos.estado;
      if (datos.fechaFinalizacion !== undefined) data.fechaFinalizacion = datos.fechaFinalizacion;

      if (Object.keys(data).length > 0) {
        await tx.tarea.update({ where: { id }, data });
      }
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
    });
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
