import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { appendHistorial } from './prisma-historial-append';
import { camposModificados } from '../../dominio/historial/detalle';
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

  async crear(datos: DatosCrearProyecto, usuarioId: string): Promise<ProyectoConMiembros> {
    return this.prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "espacios_de_trabajo" WHERE "id" = ${datos.espacioId} FOR SHARE`;
    const users = [...new Set([usuarioId, ...datos.miembrosIds])].sort();
    for (const u of users) await tx.$queryRaw`SELECT "id" FROM "usuarios" WHERE "id" = ${u} FOR KEY SHARE`;
    const miembros = await tx.$queryRaw<{usuarioId: string}[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${datos.espacioId} AND "usuarioId" = ANY(${users}) ORDER BY "usuarioId" FOR SHARE`;
    if (!miembros.some(m => m.usuarioId === usuarioId)) throw new NotFoundException('Proyecto no encontrado');
    if (users.some(u => !miembros.some(m => m.usuarioId === u))) throw new BadRequestException('Hay miembros seleccionados que no pertenecen al espacio');
    const p = await tx.proyecto.create({
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
    await appendHistorial(tx, { entidad: 'PROYECTO', entidadId: p.id, proyectoId: p.id, espacioId: datos.espacioId, usuarioId }, 'CREADO');
    return aProyectoConMiembros(p as ProyectoConFilas);
    });
  }

  async actualizar(id: string, datos: DatosActualizarProyecto, usuarioId: string): Promise<ProyectoConMiembros> {
    return this.prisma.$transaction(async tx => {
    const filas = await tx.$queryRaw<{espacioId: string; archivado: boolean; esBandejaDeEntrada: boolean}[]>`SELECT "espacioId", "archivado", "esBandejaDeEntrada" FROM "proyectos" WHERE "id" = ${id} FOR UPDATE`;
    const previo = filas[0];
    if (!previo) throw new NotFoundException('Proyecto no encontrado');
    await tx.$queryRaw`SELECT "id" FROM "usuarios" WHERE "id" = ${usuarioId} FOR KEY SHARE`;
    const permisos = await tx.$queryRaw<{usuarioId: string}[]>`SELECT "usuarioId" FROM "membresias" WHERE "espacioId" = ${previo.espacioId} AND "usuarioId" = ${usuarioId} FOR SHARE`;
    if (!permisos.length) throw new NotFoundException('Proyecto no encontrado');
    if (previo.esBandejaDeEntrada) throw new BadRequestException('La Bandeja de entrada no se puede archivar');
    // Esta operación técnica solo se usa para archivo; edición usa actualizarAutorizado.
    if (Object.keys(datos).some(k => k !== 'archivado')) throw new BadRequestException('Operación inválida');
    if (datos.archivado === undefined || datos.archivado === previo.archivado) {
      return aProyectoConMiembros(await tx.proyecto.findUniqueOrThrow({ where: { id }, include: INCLUDE_MIEMBROS }) as ProyectoConFilas);
    }
    const data: Record<string, unknown> = {};
    if (datos.nombre !== undefined && datos.nombre !== null) data.nombre = datos.nombre;
    if (datos.descripcion !== undefined) data.descripcion = datos.descripcion;
    if (datos.fechaInicio !== undefined) data.fechaInicio = datos.fechaInicio;
    if (datos.fechaFin !== undefined) data.fechaFin = datos.fechaFin;
    if (datos.archivado !== undefined) data.archivado = datos.archivado;
    const p = await tx.proyecto.update({
      where: { id },
      data,
      include: INCLUDE_MIEMBROS,
    });
    if (datos.archivado !== undefined && datos.archivado !== previo.archivado) await appendHistorial(tx, { entidad: 'PROYECTO', entidadId: id, proyectoId: id, espacioId: previo.espacioId, usuarioId }, datos.archivado ? 'ARCHIVADO' : 'DESARCHIVADO');
    return aProyectoConMiembros(p as ProyectoConFilas);
    });
  }

  async actualizarAutorizado(id: string, usuarioId: string, datos: DatosActualizarProyecto, miembrosIds?: string[]): Promise<ProyectoConMiembros> {
    if (datos.archivado !== undefined) throw new BadRequestException('Usar la operación de archivo');
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
      const anterior = await tx.proyecto.findUniqueOrThrow({ where: { id }, include: { miembros: true } });
      const cambios = camposModificados({ ...anterior, miembros: anterior.miembros.map(m => m.usuarioId) }, { ...datos, nombre: datos.nombre ?? undefined, ...(miembrosIds === undefined ? {} : { miembros: miembrosIds }) });
      if (!cambios.length) return aProyectoConMiembros(await tx.proyecto.findUniqueOrThrow({ where: { id }, include: INCLUDE_MIEMBROS }) as ProyectoConFilas);
      if (miembrosIds?.some(idMiembro => !validos.has(idMiembro))) throw new BadRequestException('Hay miembros seleccionados que no pertenecen al espacio');
      const inicio = datos.fechaInicio === undefined ? p.fechaInicio : datos.fechaInicio;
      const fin = datos.fechaFin === undefined ? p.fechaFin : datos.fechaFin;
      if (inicio && fin && fin < inicio) throw new BadRequestException('La fecha de fin no puede ser anterior a la fecha de inicio');
      const { nombre, ...resto } = datos;
      const actualizado = await tx.proyecto.update({ where: { id }, data: { ...resto, ...(nombre != null ? { nombre } : {}) }, include: INCLUDE_MIEMBROS });
      if (cambios.length) await appendHistorial(tx, { entidad: 'PROYECTO', entidadId: id, proyectoId: id, espacioId: p.espacioId, usuarioId }, 'EDITADO', { changedFields: cambios });
      if (miembrosIds !== undefined) {
        await tx.proyectoMiembro.deleteMany({ where: { proyectoId: id } });
        if (miembrosIds.length) await tx.proyectoMiembro.createMany({ data: miembrosIds.map(user => ({ proyectoId: id, usuarioId: user })) });
        const final = await tx.proyecto.findUniqueOrThrow({ where: { id }, include: INCLUDE_MIEMBROS });
        return aProyectoConMiembros(final as ProyectoConFilas);
      }
      return aProyectoConMiembros(actualizado as ProyectoConFilas);
    });
  }

  async reemplazarMiembros(proyectoId: string, usuarioIds: string[], actorId: string): Promise<void> {
    await this.actualizarAutorizado(proyectoId, actorId, {}, [...new Set(usuarioIds)]);
  }

  async eliminar(id: string, usuarioId: string): Promise<void> {
    // ON DELETE CASCADE en el schema: tareas (y sus subtareas), comentarios, adjuntos,
    // proyecto_miembros y tarea_etiquetas se eliminan en la misma operación.
    await this.prisma.$transaction(async tx => {
      const filas = await tx.$queryRaw<{espacioId: string; esBandejaDeEntrada: boolean}[]>`SELECT "espacioId", "esBandejaDeEntrada" FROM "proyectos" WHERE "id" = ${id} FOR UPDATE`;
      const p = filas[0];
      if (!p) throw new NotFoundException('Proyecto no encontrado');
      await tx.$queryRaw`SELECT "id" FROM "usuarios" WHERE "id" = ${usuarioId} FOR KEY SHARE`;
      const permisos = await tx.$queryRaw<{rol: string}[]>`SELECT "rol" FROM "membresias" WHERE "espacioId" = ${p.espacioId} AND "usuarioId" = ${usuarioId} FOR SHARE`;
      if (!permisos.length) throw new NotFoundException('Proyecto no encontrado');
      if (permisos[0]!.rol !== 'ADMINISTRADOR') throw new ForbiddenException('Se requiere rol de administrador');
      if (p.esBandejaDeEntrada) throw new BadRequestException('La Bandeja de entrada no se puede eliminar');
      const tareas = await tx.$queryRaw<{id: string}[]>`SELECT "id" FROM "tareas" WHERE "proyectoId" = ${id} ORDER BY "id" FOR UPDATE`;
      for (const t of tareas) await appendHistorial(tx, { entidad: 'TAREA', entidadId: t.id, tareaId: t.id, proyectoId: id, espacioId: p.espacioId, usuarioId }, 'ELIMINADO');
      await appendHistorial(tx, { entidad: 'PROYECTO', entidadId: id, proyectoId: id, espacioId: p.espacioId, usuarioId }, 'ELIMINADO');
      await tx.proyecto.delete({ where: { id } });
    });
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
