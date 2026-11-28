// Puerto (Clean Architecture): proyectos. Los adaptadores concretos viven en infraestructura/.

export interface ProyectoEntity {
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
}

export interface UsuarioRef {
  id: string;
  nombre: string;
  email: string;
}

export interface ProyectoConMiembros extends ProyectoEntity {
  miembros: UsuarioRef[];
}

export interface FiltrosProyectos {
  q?: string;
  archivados: boolean; // defecto false (solo no archivados)
}

export interface DatosCrearProyecto {
  nombre: string;
  descripcion?: string | null;
  fechaInicio?: Date | null;
  fechaFin?: Date | null;
  espacioId: string;
  miembrosIds: string[]; // creador ya incluido
}

export interface DatosActualizarProyecto {
  nombre?: string | null;
  descripcion?: string | null;
  fechaInicio?: Date | null;
  fechaFin?: Date | null;
  archivado?: boolean;
}

/** Tareas contables de RF-11: tareas sin subtareas + subtareas (padre con subtareas excluido). */
export interface TareaContableCruda {
  estado: 'PENDIENTE' | 'EN_CURSO' | 'HECHA';
  fechaLimite: Date | null;
}

export interface ProyectoRepository {
  /** Sin Bandeja de entrada; filtra por q (nombre, case-insensitive) y archivados. */
  listarPorEspacio(espacioId: string, filtros: FiltrosProyectos): Promise<ProyectoConMiembros[]>;
  buscarPorId(id: string): Promise<ProyectoConMiembros | null>;
  /** IDs del conjunto dado que son miembros del espacio (para validar pertenencia). */
  filtrarIdsMiembrosDelEspacio(espacioId: string, usuarioIds: string[]): Promise<string[]>;
  crear(datos: DatosCrearProyecto, usuarioId: string): Promise<ProyectoConMiembros>;
  actualizar(id: string, datos: DatosActualizarProyecto, usuarioId: string): Promise<ProyectoConMiembros>;
  actualizarAutorizado(id: string, usuarioId: string, datos: DatosActualizarProyecto, miembrosIds?: string[]): Promise<ProyectoConMiembros>;
  /** Reemplaza el conjunto completo de miembros del proyecto. */
  reemplazarMiembros(proyectoId: string, usuarioIds: string[], actorId: string): Promise<void>;
  /** Borrado físico en cascada (tareas, subtareas, comentarios, adjuntos) vía ON DELETE CASCADE del schema. */
  eliminar(id: string, usuarioId: string): Promise<void>;
  obtenerBandeja(espacioId: string): Promise<ProyectoEntity | null>;
  tareasContables(proyectoId: string): Promise<TareaContableCruda[]>;
}

export const PROYECTO_REPOSITORY = Symbol('PROYECTO_REPOSITORY');
