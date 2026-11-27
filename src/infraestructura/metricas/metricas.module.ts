import { Module } from '@nestjs/common';
import { MetricasService } from '../../aplicacion/metricas/metricas.service';
import { METRICAS_REPOSITORY } from '../../dominio/puertos/metricas.repository';
import { MetricasController } from '../../interfaces/http/metricas.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaMetricasRepository } from '../repositorios/prisma-metricas.repository';
import { ReportesController } from '../../interfaces/http/reportes.controller';
import { ReportesService } from '../../aplicacion/reportes/reportes.service';
import { REPORTE_RESUMEN_RENDERER } from '../../dominio/puertos/reporte-resumen.renderer';
import { ResumenRenderer } from '../reportes/resumen.renderer';

@Module({
  imports: [PrismaModule],
  controllers: [MetricasController, ReportesController],
  providers: [MetricasService, ReportesService, { provide: REPORTE_RESUMEN_RENDERER, useClass: ResumenRenderer }, { provide: METRICAS_REPOSITORY, useClass: PrismaMetricasRepository }],
  exports: [MetricasService],
})
export class MetricasModule {}
