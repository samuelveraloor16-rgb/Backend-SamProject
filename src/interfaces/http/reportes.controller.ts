import { Body, Controller, Get, Header, Param, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ReportesService } from '../../aplicacion/reportes/reportes.service';
import type { FormatoReporte } from '../../dominio/puertos/reporte-resumen.renderer';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ConsultaMetricasDto } from './metricas.controller';

@Controller('proyectos/:id/reportes')
@UseGuards(JwtAuthGuard)
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Get('resumen.csv')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  csv(@CurrentUser() usuario: UsuarioAutenticado, @Param('id') id: string,
    @Query() _query: ConsultaMetricasDto, @Body() _body: ConsultaMetricasDto) {
    return this.descargar(id, usuario.id, 'csv');
  }

  @Get('resumen.pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  pdf(@CurrentUser() usuario: UsuarioAutenticado, @Param('id') id: string,
    @Query() _query: ConsultaMetricasDto, @Body() _body: ConsultaMetricasDto) {
    return this.descargar(id, usuario.id, 'pdf');
  }

  private async descargar(id: string, usuario: string, formato: FormatoReporte) {
    const buffer = await this.reportes.obtener(id, usuario, formato);
    return new StreamableFile(buffer, {
      type: formato === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
      disposition: `attachment; filename="resumen-proyecto.${formato}"`,
      length: buffer.length,
    });
  }
}
