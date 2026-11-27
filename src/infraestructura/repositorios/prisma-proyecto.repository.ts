import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
import { leerTareasContables } from './tareas-contables';

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

  async actualizarAutorizado(id: string, usuarioId: string, datos: DatosActualizarProyecto, miembrosIds?: string[]): Promise<ProyectoConMiembros> {
    return this.prisma.$transaction(async tx => {
      const filas = await tx.$queryRaw<{ espacioId: string; archivado: boolean; fechaInicio: Date | null; fechaFin: Date | null }[]>`SELECT "espacioId", "archivado", "fechaInicio", "fechaFin" FROM "proyectos" WHERE "id" = ${id} FOR UPDATE`;
      const p = filas[0];
      if (!p) throw new NotFoundException('Proyecto no encontrado');
      // Match RF-19 order: proyecto, usuarios, membresías.
      for (const user of [...new Set([usuarioId, ...(miembrosIds ?? [])])].sort()) {
        await tx.$queryRaw`SELECT "id" FROM "usuarios" WHERE "id" = ${user} FOR KEY SHARE`;
      }
      const miembros = await tx.$queryRaw<{ usuarioId: string }[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${p.espacioId} AND "usuarioId" = ANY(${[...new Set([usuarioId, ...(miembrosIds ?? [])])]}) ORDER BY "usuarioId" FOR SHARE`;
      const validos = new Set(miembros.map(m => m.usuarioId));
      if (!validos.has(usuarioId)) throw new NotFoundException('Proyecto no encontrado');
      if (p.archivado) throw new BadRequestException('El proyecto está archivado');
      if (miembrosIds?.some(idMiembro => !validos.has(idMiembro))) throw new BadRequestException('Hay miembros seleccionados que no pertenecen al espacio');
      const inicio = datos.fechaInicio === undefined ? p.fechaInicio : datos.fechaInicio;
      const fin = datos.fechaFin === undefined ? p.fechaFin : datos.fechaFin;
      if (inicio && fin && fin < inicio) throw new BadRequestException('La fecha de fin no puede ser anterior a la fecha de inicio');
      const { nombre, ...resto } = datos;
      const actualizado = await tx.proyecto.update({ where: { id }, data: { ...resto, ...(nombre != null ? { nombre } : {}) }, include: INCLUDE_MIEMBROS });
      if (miembrosIds !== undefined) {
        await tx.proyectoMiembro.deleteMany({ where: { proyectoId: id } });
        if (miembrosIds.length) await tx.proyectoMiembro.createMany({ data: miembrosIds.map(user => ({ proyectoId: id, usuarioId: user })) });
        const final = await tx.proyecto.findUniqueOrThrow({ where: { id }, include: INCLUDE_MIEMBROS });
        return aProyectoConMiembros(final as ProyectoConFilas);
      }
      return aProyectoConMiembros(actualizado as ProyectoConFilas);
    });
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
    return leerTareasContables(this.prisma, proyectoId);
  }
}
