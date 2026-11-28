import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  TAREA_REPOSITORY,
  type FiltrosTareas,
  type OrdenTareas,
  type PrioridadTarea,
  type TareaCompleta,
  type TareaRepository,
} from '../../dominio/puertos/tarea.repository';
import {
  ETIQUETA_REPOSITORY,
  type EtiquetaRepository,
} from '../../dominio/puertos/etiqueta.repository';
import {
  PROYECTO_REPOSITORY,
  type ProyectoConMiembros,
  type ProyectoRepository,
} from '../../dominio/puertos/proyecto.repository';
import {
  ESPACIO_REPOSITORY,
  type EspacioRepository,
} from '../../dominio/puertos/espacio.repository';
import { asegurarMiembro } from '../comun/acceso-espacio';
import { esVencida } from '../../dominio/metricas/progreso';
import { envelope, paginarEnMemoria, type Envelope } from '../comun/paginacion';
import {
  ActualizarTareaDto,
  CambiarEstadoDto,
  CrearSubtareaDto,
  CrearTareaDto,
  ListarTareasQueryDto,
  MoverTareaDto,
  TareaRapidaDto,
} from '../dtos/tarea-dtos';

export interface TareaPublica {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: TareaCompleta['estado'];
  prioridad: PrioridadTarea;
  fechaLimite: Date | null;
  fechaFinalizacion: Date | null;
  proyectoId: string;
  responsable: TareaCompleta['responsable'];
  tareaPadreId: string | null;
  etiquetas: TareaCompleta['etiquetas'];
  vencida: boolean;
  subtareas: number;
  creadoEn: Date;
  actualizadoEn: Date;
}

export function aTareaPublica(t: TareaCompleta): TareaPublica {
  return {
    id: t.id,
    titulo: t.titulo,
    descripcion: t.descripcion,
    estado: t.estado,
    prioridad: t.prioridad,
    fechaLimite: t.fechaLimite,
    fechaFinalizacion: t.fechaFinalizacion,
    proyectoId: t.proyectoId,
    responsable: t.responsable,
    tareaPadreId: t.tareaPadreId,
    etiquetas: t.etiquetas,
    vencida: esVencida(t),
    subtareas: t.totalSubtareas,
    creadoEn: t.creadoEn,
    actualizadoEn: t.actualizadoEn,
  };
}

export const PRIORIDAD_RANGO: Record<PrioridadTarea, number> = {
  BAJA: 1,
  MEDIA: 2,
  ALTA: 3,
  URGENTE: 4,
};

// RF-16: orden estable. fechaLimite: nulls siempre al final. Default direccion: creadoEn→desc, fechaLimite→asc, prioridad→desc.
export function ordenarTareas(
  tareas: TareaCompleta[],
  orden: OrdenTareas,
  direccion?: 'asc' | 'desc',
): TareaCompleta[] {
  const dir = direccion ?? (orden === 'fechaLimite' ? 'asc' : 'desc');
  const signo = dir === 'asc' ? 1 : -1;
  return [...tareas].sort((a, b) => {
    let cmp: number;
    if (orden === 'fechaLimite') {
      const va = a.fechaLimite?.getTime() ?? null;
      const vb = b.fechaLimite?.getTime() ?? null;
      if (va === null && vb === null) cmp = 0;
      else if (va === null) return 1; // nulls last, independiente de la dirección
      else if (vb === null) return -1;
      else cmp = va - vb;
    } else if (orden === 'prioridad') {
      cmp = PRIORIDAD_RANGO[a.prioridad] - PRIORIDAD_RANGO[b.prioridad];
    } else {
      cmp = a.creadoEn.getTime() - b.creadoEn.getTime();
    }
    if (cmp === 0) cmp = a.creadoEn.getTime() - b.creadoEn.getTime();
    return cmp * signo;
  });
}

function aFiltros(q: ListarTareasQueryDto): FiltrosTareas {
  return {
    estado: q.estado,
    prioridad: q.prioridad,
    responsableId: q.responsableId?.trim() || undefined,
    q: q.q?.trim() || undefined,
    vencidas: q.vencidas === true ? true : undefined,
    orden: q.orden ?? 'creadoEn',
  };
}

@Injectable()
export class TareasService {
  constructor(
    @Inject(TAREA_REPOSITORY) private readonly tareas: TareaRepository,
    @Inject(ETIQUETA_REPOSITORY) private readonly etiquetas: EtiquetaRepository,
    @Inject(PROYECTO_REPOSITORY) private readonly proyectos: ProyectoRepository,
    @Inject(ESPACIO_REPOSITORY) private readonly espacios: EspacioRepository,
  ) {}

  // GET /proyectos/:proyectoId/tareas — RF-16 (lista + filtros). También lo consume el Kanban (RF-17).
  async listarPorProyecto(
    proyectoId: string,
    usuarioId: string,
    query: ListarTareasQueryDto,
  ): Promise<Envelope<TareaPublica>> {
    await this.exigirProyectoVisible(proyectoId, usuarioId);
    const filtros = aFiltros(query);
    const filas = await this.tareas.listar(proyectoId, filtros);
    const ordenadas = ordenarTareas(filas, filtros.orden, query.direccion);
    const corte = paginarEnMemoria(ordenadas, query.page, query.pageSize);
    return envelope(
      corte.datos.map(aTareaPublica),
      corte.total,
      query.page,
      query.pageSize,
    );
  }

  // GET /espacios/:espacioId/bandeja — RF-13. Mismos filtros; meta incluye proyectoId.
  async listarBandeja(
    espacioId: string,
    usuarioId: string,
    query: ListarTareasQueryDto,
  ): Promise<Envelope<TareaPublica> & { meta: Envelope<TareaPublica>['meta'] & { proyectoId: string } }> {
    await asegurarMiembro(this.espacios, espacioId, usuarioId);
    const bandeja = await this.proyectos.obtenerBandeja(espacioId);
    if (!bandeja) {
      throw new NotFoundException('Bandeja de entrada no encontrada');
    }
    const filtros = aFiltros(query);
    const filas = await this.tareas.listar(bandeja.id, filtros);
    const ordenadas = ordenarTareas(filas, filtros.orden, query.direccion);
    const corte = paginarEnMemoria(ordenadas, query.page, query.pageSize);
    const env = envelope(
      corte.datos.map(aTareaPublica),
      corte.total,
      query.page,
      query.pageSize,
    );
    return { datos: env.datos, meta: { ...env.meta, proyectoId: bandeja.id } };
  }

  // POST /proyectos/:proyectoId/tareas — RF-12.
  async crear(
    proyectoId: string,
    usuarioId: string,
    dto: CrearTareaDto,
  ): Promise<TareaPublica> {
    const proyecto = await this.exigirProyectoEscribible(proyectoId, usuarioId);
    const titulo = dto.titulo?.trim();
    if (!titulo) {
      throw new BadRequestException('El título no puede estar vacío');
    }
    const responsable = await this.validarResponsable(
      proyecto.espacioId,
      dto.responsableId,
      dto.responsableId !== undefined,
    );
    const etiquetasIds = await this.validarEtiquetas(proyecto.espacioId, dto.etiquetas);
    const tarea = await this.tareas.crear({
      titulo,
      descripcion: dto.descripcion ?? null,
      prioridad: dto.prioridad ?? 'MEDIA',
      fechaLimite: dto.fechaLimite ? new Date(dto.fechaLimite) : null,
      responsableId: responsable.valor ?? null,
      proyectoId,
      tareaPadreId: null,
      etiquetasIds,
    }, usuarioId);
    return aTareaPublica(tarea);
  }

  // GET /tareas/:id — RF-12. Incluye subtareasDetalle.
  async obtener(id: string, usuarioId: string): Promise<TareaPublica & { subtareasDetalle: unknown[] }> {
    const tarea = await this.exigirTareaVisible(id, usuarioId);
    const subtareas = await this.tareas.listarSubtareas(id);
    const subtareasDetalle = subtareas.map((s) => ({
      id: s.id,
      titulo: s.titulo,
      estado: s.estado,
      prioridad: s.prioridad,
      vencida: esVencida(s),
      responsable: s.responsable,
      fechaLimite: s.fechaLimite,
    }));
    return { ...aTareaPublica(tarea), subtareasDetalle };
  }

  // PATCH /tareas/:id — RF-12. NO cambia estado ni proyecto ni padre.
  async actualizar(
    id: string,
    usuarioId: string,
    dto: ActualizarTareaDto,
  ): Promise<TareaPublica> {
    const tarea = await this.exigirTareaEscribible(id, usuarioId);
    const proyecto = await this.proyectos.buscarPorId(tarea.proyectoId);
    if (!proyecto) {
      throw new NotFoundException('Proyecto no encontrado');
    }
    if (
      dto.titulo === undefined &&
      dto.descripcion === undefined &&
      dto.prioridad === undefined &&
      dto.fechaLimite === undefined &&
      dto.responsableId === undefined &&
      dto.etiquetas === undefined
    ) {
      throw new BadRequestException('No hay cambios que aplicar');
    }
    if (dto.titulo !== undefined && !dto.titulo.trim()) {
      throw new BadRequestException('El título no puede estar vacío');
    }
    const responsableId = await this.validarResponsable(
      proyecto.espacioId,
      dto.responsableId,
      dto.responsableId !== undefined,
    );
    const etiquetasIds =
      dto.etiquetas !== undefined
        ? await this.validarEtiquetas(proyecto.espacioId, dto.etiquetas)
        : undefined;

    const actualizada = await this.tareas.actualizar(id, {
      ...(dto.titulo !== undefined ? { titulo: dto.titulo.trim() } : {}),
      ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion } : {}),
      ...(dto.prioridad !== undefined ? { prioridad: dto.prioridad } : {}),
      ...(dto.fechaLimite !== undefined
        ? { fechaLimite: dto.fechaLimite === null ? null : new Date(dto.fechaLimite) }
        : {}),
      ...(responsableId.cambiado ? { responsableId: responsableId.valor } : {}),
      ...(etiquetasIds !== undefined ? { etiquetasIds } : {}),
    }, usuarioId);
    return aTareaPublica(actualizada);
  }

  // DELETE /tareas/:id — RF-12. Borra la tarea y sus subtareas (cascada).
  async eliminar(id: string, usuarioId: string): Promise<void> {
    await this.exigirTareaEscribible(id, usuarioId);
    await this.tareas.eliminar(id, usuarioId);
  }

  // POST /tareas/:id/subtareas — RF-12. Un solo nivel de anidación.
  async crearSubtarea(
    id: string,
    usuarioId: string,
    dto: CrearSubtareaDto,
  ): Promise<TareaPublica> {
    const padre = await this.tareas.buscarPorId(id);
    if (!padre) {
      throw new NotFoundException('Tarea no encontrada');
    }
    const proyecto = await this.exigirProyectoEscribible(padre.proyectoId, usuarioId);
    if (padre.tareaPadreId !== null) {
      throw new BadRequestException('Las subtareas no pueden tener subtareas');
    }
    const titulo = dto.titulo?.trim();
    if (!titulo) {
      throw new BadRequestException('El título no puede estar vacío');
    }
    const responsableId = await this.validarResponsable(
      proyecto.espacioId,
      dto.responsableId,
      dto.responsableId !== undefined,
    );
    const tarea = await this.tareas.crearSubtareaAutorizada({
      titulo,
      descripcion: dto.descripcion ?? null,
      prioridad: dto.prioridad ?? 'MEDIA',
      fechaLimite: dto.fechaLimite ? new Date(dto.fechaLimite) : null,
      responsableId: responsableId.valor ?? null,
      proyectoId: padre.proyectoId,
      tareaPadreId: padre.id,
      etiquetasIds: [],
    }, usuarioId);
    return aTareaPublica(tarea);
  }

  // PATCH /tareas/:id/estado — RF-14/RF-22. El repositorio deriva el estado anterior
  // bajo lock, actualiza la tarea y registra FINALIZADA/REABIERTA en la misma transacción.
  async cambiarEstado(
    id: string,
    usuarioId: string,
    dto: CambiarEstadoDto,
  ): Promise<TareaPublica> {
    await this.exigirTareaEscribible(id, usuarioId);
    const actualizada = await this.tareas.cambiarEstado(id, dto.estado, usuarioId);
    return aTareaPublica(actualizada);
  }

  // POST /tareas/rapida — RF-13. Máx. 2 toques: solo titulo (+ espacioId opcional).
  async rapida(usuarioId: string, dto: TareaRapidaDto): Promise<TareaPublica> {
    const titulo = dto.titulo?.trim();
    if (!titulo) {
      throw new BadRequestException('El título no puede estar vacío');
    }
    let espacioId = dto.espacioId?.trim();
    if (espacioId) {
      await asegurarMiembro(this.espacios, espacioId, usuarioId); // ajeno → 404
    } else {
      const personal = (await this.espacios.listarDeUsuario(usuarioId)).find(
        (e) => e.espacio.esPersonal,
      );
      if (!personal) {
        throw new BadRequestException('No tienes un espacio personal');
      }
      espacioId = personal.espacio.id;
    }
    const bandeja = await this.proyectos.obtenerBandeja(espacioId);
    if (!bandeja) {
      throw new BadRequestException('El espacio no tiene Bandeja de entrada');
    }
    const tarea = await this.tareas.crear({
      titulo,
      descripcion: null,
      prioridad: 'MEDIA',
      fechaLimite: null,
      responsableId: null,
      proyectoId: bandeja.id,
      tareaPadreId: null,
      etiquetasIds: [],
    }, usuarioId);
    return aTareaPublica(tarea);
  }

  // POST /tareas/:id/mover — RF-13. Mismo espacio; subtareas viajan con la tarea.
  async mover(id: string, usuarioId: string, dto: MoverTareaDto): Promise<TareaPublica> {
    const tarea = await this.tareas.buscarPorId(id);
    if (!tarea) {
      throw new NotFoundException('Tarea no encontrada');
    }
    const origen = await this.proyectos.buscarPorId(tarea.proyectoId);
    if (!origen) {
      throw new NotFoundException('Proyecto origen no encontrado');
    }
    await asegurarMiembro(this.espacios, origen.espacioId, usuarioId); // ajeno → 404
    if (origen.archivado) {
      throw new BadRequestException('El proyecto está archivado');
    }

    const destino = await this.proyectos.buscarPorId(dto.proyectoId.trim());
    if (!destino) {
      throw new NotFoundException('Proyecto destino no encontrado');
    }
    await asegurarMiembro(this.espacios, destino.espacioId, usuarioId); // ajeno → 404
    if (origen.espacioId !== destino.espacioId) {
      throw new BadRequestException('No se puede mover entre espacios distintos');
    }
    if (destino.archivado) {
      throw new BadRequestException('El proyecto destino está archivado');
    }

    if (origen.id !== destino.id && tarea.tareaPadreId !== null) {
      throw new BadRequestException('No se puede mover una subtarea independientemente');
    }
    const actualizada = await this.tareas.moverConSubtareas(id, destino.id, usuarioId);
    return aTareaPublica(actualizada);
  }

  // ---------- helpers ----------

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

  /** Proyecto existente, miembro del espacio y NO archivado (escrituras de tareas → 400 si archivado). */
  private async exigirProyectoEscribible(
    id: string,
    usuarioId: string,
  ): Promise<ProyectoConMiembros> {
    const p = await this.exigirProyectoVisible(id, usuarioId);
    if (p.archivado) {
      throw new BadRequestException('El proyecto está archivado');
    }
    return p;
  }

  private async exigirTareaVisible(id: string, usuarioId: string): Promise<TareaCompleta> {
    const tarea = await this.tareas.buscarPorId(id);
    if (!tarea) {
      throw new NotFoundException('Tarea no encontrada');
    }
    const proyecto = await this.proyectos.buscarPorId(tarea.proyectoId);
    if (!proyecto) {
      throw new NotFoundException('Proyecto no encontrado');
    }
    await asegurarMiembro(this.espacios, proyecto.espacioId, usuarioId);
    return tarea;
  }

  private async exigirTareaEscribible(id: string, usuarioId: string): Promise<TareaCompleta> {
    const tarea = await this.tareas.buscarPorId(id);
    if (!tarea) {
      throw new NotFoundException('Tarea no encontrada');
    }
    await this.exigirProyectoEscribible(tarea.proyectoId, usuarioId);
    return tarea;
  }

  /**
   * Valida responsableId: undefined = no viene en el body; null = desasignar;
   * string = debe ser miembro del espacio (400 si no).
   */
  private async validarResponsable(
    espacioId: string,
    responsableId: string | null | undefined,
    presente?: boolean,
  ): Promise<{ valor: string | null | undefined; cambiado: boolean }> {
    const viene = presente ?? responsableId !== undefined;
    if (!viene) {
      return { valor: undefined, cambiado: false };
    }
    if (responsableId == null) {
      return { valor: null, cambiado: true }; // desasignar
    }
    const validos = await this.proyectos.filtrarIdsMiembrosDelEspacio(espacioId, [responsableId]);
    if (validos.length !== 1) {
      throw new BadRequestException('El responsable no es miembro del espacio');
    }
    return { valor: responsableId, cambiado: true };
  }

  private async validarEtiquetas(
    espacioId: string,
    ids: string[] | undefined,
  ): Promise<string[]> {
    if (!ids || ids.length === 0) return [];
    const unicos = [...new Set(ids)];
    const encontradas = await this.etiquetas.buscarPorIdsEnEspacio(espacioId, unicos);
    if (encontradas.length !== unicos.length) {
      throw new BadRequestException('Hay etiquetas que no pertenecen al espacio');
    }
    return unicos;
  }
}
