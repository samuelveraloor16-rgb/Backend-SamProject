// RF22 historial — reglas puras de transición y fotografía del evento.
// La fuente de verdad del pasado es el evento registrado; no se recalcula desde la tarea actual.

import type { EstadoTarea } from '../puertos/tarea.repository';

export type TipoEventoFinalizacion = 'FINALIZADA' | 'REABIERTA';

/** Fotografía inmutable: lo que se registra y nunca se actualiza ni se borra. */
export interface EventoFinalizacion {
  id: string;
  tareaId: string;
  proyectoId: string;
  estadoAnterior: EstadoTarea;
  estadoNuevo: EstadoTarea;
  tipo: TipoEventoFinalizacion;
  usuarioId: string;
  /** Regla RF11 en el instante del evento: true si la tarea no tenía subtareas. */
  contable: boolean;
  ocurridoEn: Date;
}

export type EfectoFechaFinalizacion = 'NO_TOCAR' | 'ESTABLECER' | 'LIMPIAR';

export interface EfectoTransicion {
  /** null = no hay transición real que registrar. */
  tipo: TipoEventoFinalizacion | null;
  fechaFinalizacion: EfectoFechaFinalizacion;
}

/**
 * Decide si una transición de estado genera evento y qué hacer con `fechaFinalizacion`.
 * - HECHA→HECHA y estados intermedios (no HECHA) no generan evento ni tocan la fecha.
 * - Entrar en HECHA desde otro estado: FINALIZADA y se establece la fecha.
 * - Salir de HECHA: REABIERTA y se limpia la fecha.
 */
export function resolverTransicion(
  estadoAnterior: EstadoTarea,
  estadoNuevo: EstadoTarea,
): EfectoTransicion {
  if (estadoAnterior === estadoNuevo) {
    return { tipo: null, fechaFinalizacion: 'NO_TOCAR' };
  }
  if (estadoNuevo === 'HECHA') {
    return { tipo: 'FINALIZADA', fechaFinalizacion: 'ESTABLECER' };
  }
  if (estadoAnterior === 'HECHA') {
    return { tipo: 'REABIERTA', fechaFinalizacion: 'LIMPIAR' };
  }
  return { tipo: null, fechaFinalizacion: 'NO_TOCAR' };
}
