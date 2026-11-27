import type { calcularProgreso } from '../metricas/progreso';
import type { calcularRitmoSemanal } from '../metricas/ritmo-semanal';

export interface ResumenIdentificado {
  proyecto: { id: string; nombre: string };
  metricas: ReturnType<typeof calcularProgreso> & {
    proyectoId: string; calculadoEn: Date; trabajoPendiente: number;
    ritmo: ReturnType<typeof calcularRitmoSemanal>;
  };
}
export type FormatoReporte = 'csv' | 'pdf';
export const REPORTE_RESUMEN_RENDERER = Symbol('REPORTE_RESUMEN_RENDERER');
export interface ReporteResumenRenderer {
  generar(resumen: ResumenIdentificado, formato: FormatoReporte): Promise<Buffer>;
}
