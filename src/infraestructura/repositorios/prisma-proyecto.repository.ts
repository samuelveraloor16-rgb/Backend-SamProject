import { Injectable } from '@nestjs/common';
import type {
  ProyectoRepository,
  ProyectoEntity,
  ProyectoConMiembros,
  UsuarioRef,
  FiltrosProyectos,
  DatosCrearProyecto,
  DatosActualizarProyecto,
  TareaContableCruda,
} from '../../dominio/puertos/proyecto.repository';
import { PrismaService } from '../prisma/prisma.service';

const INCLUDE_MIEMBROS = {
  miembros: { include: { usuario: { select: { id: true, nombre: true, email: true } } } },
} as const;

type ProyectoConFilas = {
  id: string;
  nombre: string;
  descripcion: string | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  archivado: boolean;
  esBandejaDeEntrada: boolean;
  espacioId: string;
  creadoEn: Date;
  actualizadoEn: Date;
  eliminadoEn: Date | null;
  miembros: { usuario: UsuarioRef }[];
};

function aProyectoEntity(p: Omit<ProyectoConFilas, 'miembros'>): ProyectoEntity {
  return { ...p };
}

function aProyectoConMiembros(p: ProyectoConFilas): ProyectoConMiembros {
  const { miembros, ...resto } = p;
  return { ...resto, miembros: miembros.map((m) => m.usuario) };
}

@Injectable()
export class PrismaProyectoRepository implements ProyectoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listarPorEspacio(
    espacioId: string,
    filtros: FiltrosProyectos,
  ): Promise<ProyectoConMiembros[]> {
    const filas = await this.prisma.proyecto.findMany({
      where: {
        espacioId,
        esBandejaDeEntrada: false,
        archivado: filtros.archivados ? undefined : false,
        ...(filtros.q
          ? { nombre: { contains: filtros.q, mode: 'insensitive' as const } }
          : {}),
      },
      include: INCLUDE_MIEMBROS,
      orderBy: { creadoEn: 'asc' },
    });
    return filas.map(aProyectoConMiembros);
  }

  async buscarPorId(id: string): Promise<ProyectoConMiembros | null> {
    const p = await this.prisma.proyecto.findUnique({
      where: { id },
      include: INCLUDE_MIEMBROS,
    });
    return p ? aProyectoConMiembros(p as ProyectoConFilas) : null;
  }

  async filtrarIdsMiembrosDelEspacio(espacioId: string, usuarioIds: string[]): Promise<string[]> {
    if (usuarioIds.length === 0) return [];
    const filas = await this.prisma.membresia.findMany({
      where: { espacioId, usuarioId: { in: usuarioIds } },
      select: { usuarioId: true },
    });
    return filas.map((f) => f.usuarioId);
  }

  async crear(datos: DatosCrearProyecto): Promise<ProyectoConMiembros> {
    const p = await this.prisma.proyecto.create({
      data: {
        nombre: datos.nombre,
        descripcion: datos.descripcion ?? null,
        fechaInicio: datos.fechaInicio ?? null,
        fechaFin: datos.fechaFin ?? null,
        espacioId: datos.espacioId,
        miembros: {
          create: datos.miembrosIds.map((usuarioId) => ({ usuarioId })),
        },
      },
      include: INCLUDE_MIEMBROS,
    });
    return aProyectoConMiembros(p as ProyectoConFilas);
  }

  async actualizar(id: string, datos: DatosActualizarProyecto): Promise<ProyectoConMiembros> {
    const data: Record<string, unknown> = {};
    if (datos.nombre !== undefined && datos.nombre !== null) data.nombre = datos.nombre;
    if (datos.descripcion !== undefined) data.descripcion = datos.descripcion;
    if (datos.fechaInicio !== undefined) data.fechaInicio = datos.fechaInicio;
    if (datos.fechaFin !== undefined) data.fechaFin = datos.fechaFin;
    if (datos.archivado !== undefined) data.archivado = datos.archivado;
    const p = await this.prisma.proyecto.update({
      where: { id },
      data,
      include: INCLUDE_MIEMBROS,
    });
    return aProyectoConMiembros(p as ProyectoConFilas);
  }

  async reemplazarMiembros(proyectoId: string, usuarioIds: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.proyectoMiembro.deleteMany({ where: { proyectoId } }),
      this.prisma.proyectoMiembro.createMany({
        data: usuarioIds.map((usuarioId) => ({ proyectoId, usuarioId })),
        skipDuplicates: true,
      }),
    ]);
  }

  async eliminar(id: string): Promise<void> {
    // ON DELETE CASCADE en el schema: tareas (y sus subtareas), comentarios, adjuntos,
    // proyecto_miembros y tarea_etiquetas se eliminan en la misma operación.
    await this.prisma.proyecto.delete({ where: { id } });
  }

  async obtenerBandeja(espacioId: string): Promise<ProyectoEntity | null> {
    const p = await this.prisma.proyecto.findFirst({
      where: { espacioId, esBandejaDeEntrada: true },
    });
    return p ? aProyectoEntity(p) : null;
  }

  async tareasContables(proyectoId: string): Promise<TareaContableCruda[]> {
    // Padre con subtareas no cuenta; el resto sí (RF-11).
    const padres = await this.prisma.tarea.findMany({
      where: { proyectoId, subtareas: { some: {} } },
      select: { id: true },
    });
    const idsPadres = padres.map((p) => p.id);
    const filas = await this.prisma.tarea.findMany({
      where: { proyectoId, ...(idsPadres.length > 0 ? { id: { notIn: idsPadres } } : {}) },
      select: { estado: true, fechaLimite: true },
    });
    return filas;
  }
}
