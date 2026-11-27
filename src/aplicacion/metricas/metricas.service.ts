import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { calcularProgreso } from '../../dominio/metricas/progreso';
import { METRICAS_REPOSITORY, type MetricasRepository } from '../../dominio/puertos/metricas.repository';
import { calcularRitmoSemanal } from '../../dominio/metricas/ritmo-semanal';

@Injectable()
export class MetricasService {
  constructor(@Inject(METRICAS_REPOSITORY) private readonly metricas: MetricasRepository) {}

  async obtener(proyectoId: string, usuarioId: string) {
    return (await this.obtenerResumenIdentificado(proyectoId, usuarioId)).metricas;
  }

  /** Proyección interna: identificación y cifras de la misma lectura autorizada. */
  async obtenerResumenIdentificado(proyectoId: string, usuarioId: string) {
    const instantanea = await this.metricas.leerInstantaneaVisible(proyectoId, usuarioId);
    if (instantanea === null) throw new NotFoundException('Proyecto no encontrado');
    const { contables, calculadoEn } = instantanea;
    const resumen = calcularProgreso(contables, calculadoEn);
    return { proyecto: instantanea.proyecto, metricas: {
      proyectoId,
      calculadoEn,
      ...resumen,
      trabajoPendiente: resumen.pendientes + resumen.enCurso,
      ritmo: calcularRitmoSemanal(calculadoEn, instantanea.historial),
    } };
  }
}
