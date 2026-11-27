import { Body, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MetricasService } from '../../aplicacion/metricas/metricas.service';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

/** DTO intencionadamente vacío: ValidationPipe global rechaza campos ajenos. */
export class ConsultaMetricasDto {}

@Controller('proyectos/:id/metricas')
@UseGuards(JwtAuthGuard)
export class MetricasController {
  constructor(private readonly metricas: MetricasService) {}

  @Get()
  obtener(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Query() _query: ConsultaMetricasDto,
    @Body() _body: ConsultaMetricasDto,
  ) {
    return this.metricas.obtener(id, usuario.id);
  }
}
