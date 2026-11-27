import { Module } from '@nestjs/common';
import { MetricasService } from '../../aplicacion/metricas/metricas.service';
import { METRICAS_REPOSITORY } from '../../dominio/puertos/metricas.repository';
import { MetricasController } from '../../interfaces/http/metricas.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaMetricasRepository } from '../repositorios/prisma-metricas.repository';

@Module({
  imports: [PrismaModule],
  controllers: [MetricasController],
  providers: [MetricasService, { provide: METRICAS_REPOSITORY, useClass: PrismaMetricasRepository }],
  exports: [MetricasService],
})
export class MetricasModule {}
