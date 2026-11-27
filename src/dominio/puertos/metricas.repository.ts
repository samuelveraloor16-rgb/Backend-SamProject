import type { TareaContable } from '../metricas/progreso';
import type { HistorialSemanal } from '../metricas/ritmo-semanal';

export const METRICAS_REPOSITORY = Symbol('METRICAS_REPOSITORY');

export interface MetricasRepository {
  /** Una instantánea y un corte BD; null oculta ajenos. */
  leerInstantaneaVisible(proyectoId: string, usuarioId: string): Promise<{
    proyecto: { id: string; nombre: string };
    calculadoEn: Date;
    contables: TareaContable[];
    historial: HistorialSemanal;
  } | null>;
}
