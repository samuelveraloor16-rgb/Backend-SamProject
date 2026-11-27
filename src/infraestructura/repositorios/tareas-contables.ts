import type { Prisma } from '@prisma/client';
import type { TareaContable } from '../../dominio/metricas/progreso';

/** Selección RF11 compartida: una sola sentencia, sin lista de padres desfasada. */
export function leerTareasContables(
  db: Pick<Prisma.TransactionClient, 'tarea'>,
  proyectoId: string,
): Promise<TareaContable[]> {
  return db.tarea.findMany({
    where: { proyectoId, subtareas: { none: {} } },
    select: { estado: true, fechaLimite: true },
  });
}
