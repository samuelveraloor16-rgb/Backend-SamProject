import type { Prisma } from '@prisma/client';
import type {
  TipoEventoFinalizacion,
} from '../../dominio/metricas/historial-finalizaciones';
import type { EstadoTarea } from '../../dominio/puertos/tarea.repository';

export interface DatosEventoFinalizacion {
  tareaId: string;
  proyectoId: string;
  estadoAnterior: EstadoTarea;
  estadoNuevo: EstadoTarea;
  tipo: TipoEventoFinalizacion;
  usuarioId: string;
  contable: boolean;
  ocurridoEn: Date;
}

/**
 * Inserción append-only dentro de la MISMA transacción que actualiza la tarea.
 * Si esta escritura falla, la transacción revierte y el cambio de estado no queda.
 * No hay update/delete de eventos en el repositorio.
 */
export function registrarEventoFinalizacion(
  db: Pick<Prisma.TransactionClient, 'eventoFinalizacionTarea'>,
  datos: DatosEventoFinalizacion,
) {
  return db.eventoFinalizacionTarea.create({ data: datos });
}
