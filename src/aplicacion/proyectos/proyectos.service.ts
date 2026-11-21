import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PROYECTO_REPOSITORY,
  type ProyectoRepository,
  type ProyectoConMiembros,
  type UsuarioRef,
} from '../../dominio/puertos/proyecto.repository';
import {
  ESPACIO_REPOSITORY,
  type EspacioRepository,
} from '../../dominio/puertos/espacio.repository';
import { asegurarAdministrador, asegurarMiembro } from '../comun/acceso-espacio';
import { calcularProgreso, type ResumenProgreso } from '../../dominio/metricas/progreso';
import { envelope, paginarEnMemoria, type Envelope } from '../comun/paginacion';
import {
  ArchivarProyectoDto,
  ActualizarProyectoDto,
  CrearProyectoDto,
  ListarProyectosQueryDto,
} from '../dtos/proyecto-dtos';

export interface ProyectoPublico {
  id: string;
  nombre: string;
  descripcion: string | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  archivado: boolean;
  esBandejaDeEntrada: boolean;
  espacioId: string;
  miembros: UsuarioRef[];
  progreso: number;
  creadoEn: Date;
  actualizadoEn: Date;
}

function aProyectoPublico(p: ProyectoConMiembros, progreso: number): ProyectoPublico {
  return {
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    fechaInicio: p.fechaInicio,
    fechaFin: p.fechaFin,
    archivado: p.archivado,
    esBandejaDeEntrada: p.esBandejaDeEntrada,
    espacioId: p.espacioId,
    miembros: p.miembros,
    progreso,
    creadoEn: p.creadoEn,
    actualizadoEn: p.actualizadoEn,
  };
}

function validarRangoFechas(inicio: Date | null, fin: Date | null): void {
  if (inicio && fin && fin.getTime() < inicio.getTime()) {
    throw new BadRequestException('La fecha de fin no puede ser anterior a la fecha de inicio');
  }
}

@Injectable()
export class ProyectosService {
  constructor(
    @Inject(PROYECTO_REPOSITORY) private readonly proyectos: ProyectoRepository,
    @Inject(ESPACIO_REPOSITORY) private readonly espacios: EspacioRepository,
  ) {}

  private async progresoDe(proyectoId: string): Promise<ResumenProgreso> {
    return calcularProgreso(await this.proyectos.tareasContables(proyectoId));
  }

  private async publicoDe(p: ProyectoConMiembros): Promise<ProyectoPublico> {
    return aProyectoPublico(p, (await this.progresoDe(p.id)).progreso);
  }

  // GET /espacios/:espacioId/proyectos — la Bandeja de entrada NO aparece aquí.
  async listar(
    espacioId: string,
    usuarioId: string,
    query: ListarProyectosQueryDto,
  ): Promise<Envelope<ProyectoPublico>> {
    await asegurarMiembro(this.espacios, espacioId, usuarioId);
    const filas = await this.proyectos.listarPorEspacio(espacioId, {
      q: query.q?.trim() || undefined,
      archivados: query.archivados,
    });
    const datos = await Promise.all(filas.map((p) => this.publicoDe(p)));
    const corte = paginarEnMemoria(datos, query.page, query.pageSize);
    return envelope(corte.datos, corte.total, query.page, query.pageSize);
  }

  // POST /espacios/:espacioId/proyectos — RF-09/RF-10. El creador se añade como miembro.
  async crear(
    espacioId: string,
    usuarioId: string,
    dto: CrearProyectoDto,
  ): Promise<ProyectoPublico> {
    await asegurarMiembro(this.espacios, espacioId, usuarioId);
    const nombre = dto.nombre?.trim();
    if (!nombre) {
      throw new BadRequestException('El nombre del proyecto no puede estar vacío');
    }
    const fechaInicio = dto.fechaInicio ? new Date(dto.fechaInicio) : null;
    const fechaFin = dto.fechaFin ? new Date(dto.fechaFin) : null;
    validarRangoFechas(fechaInicio, fechaFin);

    const miembrosIds = [...new Set([usuarioId, ...(dto.miembros ?? [])])];
    await this.asegurarMiembrosDelEspacio(espacioId, miembrosIds);

    const creado = await this.proyectos.crear({
      nombre,
      descripcion: dto.descripcion ?? null,
      fechaInicio,
      fechaFin,
      espacioId,
      miembrosIds,
    });
    return this.publicoDe(creado);
  }

  // GET /proyectos/:id
  async obtener(id: string, usuarioId: string): Promise<ProyectoPublico> {
    const p = await this.exigirProyectoVisible(id, usuarioId);
    return this.publicoDe(p);
  }

  // PATCH /proyectos/:id — RF-09. No editable si archivado (usar archivar/desarchivar).
  async actualizar(
    id: string,
    usuarioId: string,
    dto: ActualizarProyectoDto,
  ): Promise<ProyectoPublico> {
    const p = await this.exigirProyectoVisible(id, usuarioId);
    if (p.archivado) {
      throw new BadRequestException('El proyecto está archivado');
    }
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('No hay cambios que aplicar');
    }
    if (dto.nombre !== undefined && (typeof dto.nombre !== 'string' || !dto.nombre.trim())) {
      throw new BadRequestException('El nombre del proyecto no puede estar vacío');
    }
    if (dto.miembros !== undefined && !Array.isArray(dto.miembros)) {
      throw new BadRequestException('Los miembros deben ser un arreglo');
    }
    const fechaInicio =
      dto.fechaInicio === undefined ? p.fechaInicio : dto.fechaInicio === null ? null : new Date(dto.fechaInicio);
    const fechaFin =
      dto.fechaFin === undefined ? p.fechaFin : dto.fechaFin === null ? null : new Date(dto.fechaFin);
    validarRangoFechas(fechaInicio, fechaFin);

    const actualizado = await this.proyectos.actualizarAutorizado(id, usuarioId, {
      ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
      ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion } : {}),
      ...(dto.fechaInicio !== undefined ? { fechaInicio } : {}),
      ...(dto.fechaFin !== undefined ? { fechaFin } : {}),
    }, dto.miembros === undefined ? undefined : [...new Set(dto.miembros)]);
    return this.publicoDe(actualizado);
  }

  // DELETE /proyectos/:id — RF-09. Solo ADMINISTRADOR. Borrado físico en cascada.
  async eliminar(id: string, usuarioId: string): Promise<void> {
    const p = await this.exigirProyecto(id);
    await asegurarAdministrador(this.espacios, p.espacioId, usuarioId);
    if (p.esBandejaDeEntrada) {
      throw new BadRequestException('La Bandeja de entrada no se puede eliminar');
    }
    await this.proyectos.eliminar(id);
  }

  // POST /proyectos/:id/archivar — RF-09. Miembro del espacio. Bandeja no archivable.
  async archivar(
    id: string,
    usuarioId: string,
    dto: ArchivarProyectoDto,
  ): Promise<ProyectoPublico> {
    const p = await this.exigirProyectoVisible(id, usuarioId);
    if (p.esBandejaDeEntrada) {
      throw new BadRequestException('La Bandeja de entrada no se puede archivar');
    }
    const actualizado = await this.proyectos.actualizar(id, { archivado: dto.archivado });
    return this.publicoDe(actualizado);
  }

  // GET /proyectos/:id/progreso — RF-11. Fuente única de verdad de progreso.
  async progreso(id: string, usuarioId: string): Promise<ResumenProgreso> {
    await this.exigirProyectoVisible(id, usuarioId);
    return this.progresoDe(id);
  }

  private async exigirProyecto(id: string): Promise<ProyectoConMiembros> {
    const p = await this.proyectos.buscarPorId(id);
    if (!p) {
      throw new NotFoundException('Proyecto no encontrado');
    }
    return p;
  }

  private async exigirProyectoVisible(
    id: string,
    usuarioId: string,
  ): Promise<ProyectoConMiembros> {
    const p = await this.exigirProyecto(id);
    await asegurarMiembro(this.espacios, p.espacioId, usuarioId);
    return p;
  }

  private async asegurarMiembrosDelEspacio(espacioId: string, usuarioIds: string[]): Promise<void> {
    const ids = [...new Set(usuarioIds)];
    const validos = await this.proyectos.filtrarIdsMiembrosDelEspacio(espacioId, ids);
    if (validos.length !== ids.length) {
      throw new BadRequestException(
        'Hay miembros seleccionados que no pertenecen al espacio',
      );
    }
  }
}
