import { Inject, Injectable, InternalServerErrorException, UnprocessableEntityException } from '@nestjs/common';
import { MetricasService } from '../metricas/metricas.service';
import { REPORTE_RESUMEN_RENDERER, type ReporteResumenRenderer, type FormatoReporte } from '../../dominio/puertos/reporte-resumen.renderer';

export const MAX_REPORTE_BYTES = 1024 * 1024;
@Injectable()
export class ReportesService {
  constructor(private readonly metricas: MetricasService,
    @Inject(REPORTE_RESUMEN_RENDERER) private readonly renderer: ReporteResumenRenderer) {}

  async obtener(id: string, usuario: string, formato: FormatoReporte) {
    // Autorización fuera del catch: mantiene exactamente los errores RF22.
    const resumen = await this.metricas.obtenerResumenIdentificado(id, usuario);
    try {
      for (const texto of [resumen.proyecto.id, resumen.proyecto.nombre]) {
        if (/[\uD800-\uDFFF]/u.test(texto) || [...texto].length > 1000 || texto.split(/\r\n|\r|\n/u).length > 32) {
          throw new UnprocessableEntityException('Contenido del reporte excede los límites');
        }
      }
      const buffer = await this.renderer.generar(resumen, formato);
      if (buffer.length > MAX_REPORTE_BYTES) throw new UnprocessableEntityException('Contenido del reporte excede los límites');
      return buffer;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      // No registrar error crudo: puede contener nombre/documento privado.
      throw new InternalServerErrorException('No se pudo generar el reporte');
    }
  }
}
