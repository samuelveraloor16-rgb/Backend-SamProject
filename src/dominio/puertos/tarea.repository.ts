// Puerto (Clean Architecture): tareas y subtareas. Los adaptadores concretos viven en infraestructura/.

export type EstadoTarea = 'PENDIENTE' | 'EN_CURSO' | 'HECHA';
export type PrioridadTarea = 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE';

export interface TareaEntity {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: EstadoTarea;
  prioridad: PrioridadTarea;
  fechaLimite: Date | null;
  fechaFinalizacion: Date | null;
  proyectoId: string;
  responsableId: string | null;
  tareaPadreId: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface EtiquetaRef {
  id: string;
  nombre: string;
  color: string | null;
}

export interface UsuarioRef {
  id: string;
  nombre: string;
  email: string;
}

/** Tarea con sus relaciones planas para serializar el objeto `Tarea` de la API. */
export interface TareaCompleta extends TareaEntity {
  responsable: UsuarioRef | null;
  etiquetas: EtiquetaRef[];
  totalSubtareas: number;
}

export type OrdenTareas = 'creadoEn' | 'fechaLimite' | 'prioridad';

export interface FiltrosTareas {
  estado?: EstadoTarea;
  prioridad?: PrioridadTarea;
  responsableId?: string;
  q?: string;
  vencidas?: boolean; // RF-15: fechaLimite pasada (inicio de hoy) y estado != HECHA
  orden: OrdenTareas;
}

export interface DatosCrearTarea {
  titulo: string;
  descripcion?: string | null;
  prioridad: PrioridadTarea;
  fechaLimite?: Date | null;
  responsableId?: string | null;
  proyectoId: string;
  tareaPadreId?: string | null;
  etiquetasIds: string[];
}

export interface DatosActualizarTarea {
  titulo?: string | null;
  descripcion?: string | null;
  prioridad?: PrioridadTarea;
  fechaLimite?: Date | null;
  responsableId?: string | null;
  estado?: EstadoTarea;
  fechaFinalizacion?: Date | null;
  etiquetasIds?: string[]; // reemplaza el conjunto completo
}

export interface TareaRepository {
  /** RF-18: tareas (NO subtareas) con fechaLimite dentro de la ventana, de proyectos NO archivados del espacio (la Bandeja de entrada se incluye). */
  listarCalendario(espacioId: string, rango: RangoCalendarioConsulta): Promise<TareaCompleta[]>;
  /** Aplica filtros en BD y devuelve TODAS las coincidencias sin ordenar (el servicio ordena y pagina). */
  listar(proyectoId: string, filtros: FiltrosTareas): Promise<TareaCompleta[]>;
  buscarPorId(id: string): Promise<TareaCompleta | null>;
  listarSubtareas(padreId: string): Promise<TareaCompleta[]>;
  crear(datos: DatosCrearTarea): Promise<TareaCompleta>;
  actualizar(id: string, datos: DatosActualizarTarea): Promise<TareaCompleta>;
  /** Borra la tarea y sus subtareas (cascada). */
  eliminar(id: string): Promise<void>;
  /** Mueve la tarea y sus subtareas al proyecto destino (mismo espacio, validado en servicio). */
  moverConSubtareas(tareaId: string, destinoProyectoId: string): Promise<void>;
}

/** Ventana efectiva del calendario (RF-18). `null` = sin límite en ese extremo. */
export interface RangoCalendarioConsulta {
  desde: Date | null;
  hasta: Date | null;
}

export const TAREA_REPOSITORY = Symbol('TAREA_REPOSITORY');
