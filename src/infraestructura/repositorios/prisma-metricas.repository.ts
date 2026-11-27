import { Injectable } from '@nestjs/common';
import type { MetricasRepository } from '../../dominio/puertos/metricas.repository';
import { PrismaService } from '../prisma/prisma.service';
import { leerTareasContables } from './tareas-contables';
import { inicioVentanaSemanal } from '../../dominio/metricas/ritmo-semanal';

@Injectable()
export class PrismaMetricasRepository implements MetricasRepository {
  constructor(private readonly prisma: PrismaService) {}

  leerInstantaneaVisible(proyectoId: string, usuarioId: string) {
    return this.prisma.$transaction(async tx => {
      const [reloj] = await tx.$queryRaw<{ corte: Date }[]>`SELECT statement_timestamp() AS corte`;
      if (!reloj) throw new Error('Reloj BD no disponible');
      const calculadoEn = reloj.corte;
      const proyecto = await tx.proyecto.findFirst({
        where: {
          id: proyectoId,
          eliminadoEn: null,
          espacio: { membresias: { some: { usuarioId } } },
        },
        select: { id: true, nombre: true },
      });
      if (!proyecto) return null;
      const contables = await leerTareasContables(tx, proyecto.id);
      const frontera = await tx.fronteraHistorialFinalizaciones.findUnique({ where: { id: 1 }, select: { desde: true } });
      const inicio = inicioVentanaSemanal(calculadoEn);
      // Agregación acotada a cinco grupos, sin joins a tareas actuales (borrado/movimiento).
      const grupos = await tx.$queryRaw<{ inicio: Date; finalizaciones: number }[]>`
        SELECT (date_trunc('week', "ocurridoEn" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS inicio,
               count(*)::integer AS finalizaciones
        FROM "eventos_finalizacion_tarea"
        WHERE "proyectoId" = ${proyecto.id}
          AND "tipo" = 'FINALIZADA' AND "contable" = true
          AND "ocurridoEn" >= ${inicio} AND "ocurridoEn" < ${calculadoEn}
        GROUP BY 1 ORDER BY 1 LIMIT 5`;
      return { proyecto, calculadoEn, contables, historial: {
        desde: frontera?.desde ?? null,
        // No hay evidencia persistida de activación continua de TODOS los escritores.
        coberturaAcreditada: false,
        evidencia: null,
        grupos,
      } };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
