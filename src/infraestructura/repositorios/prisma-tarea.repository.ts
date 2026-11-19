import { Injectable } from '@nestjs/common';
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

  async moverConSubtareas(tareaId: string, destinoProyectoId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.tarea.update({ where: { id: tareaId }, data: { proyectoId: destinoProyectoId } }),
      this.prisma.tarea.updateMany({
        where: { tareaPadreId: tareaId },
        data: { proyectoId: destinoProyectoId },
      }),
    ]);
  }
}
