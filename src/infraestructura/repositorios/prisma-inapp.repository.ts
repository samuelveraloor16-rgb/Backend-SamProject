import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import type { NuevoPush } from '../../dominio/puertos/push-outbox.repository';

/** Solo se invoca bajo los locks del negocio y dentro de su transacción.
 * La identidad no contiene tipo/preferencia y no tiene FK a datos purgables. */
export async function registrarAviso(tx: Prisma.TransactionClient, evento: NuevoPush): Promise<boolean> {
  const conComentario = evento.tipo === 'MENCION' || evento.tipo === 'COMENTARIO';
  if (conComentario !== Boolean(evento.comentarioId) || !evento.tareaId || !evento.usuarioId || !evento.claveUnica) {
    throw new Error('Evento de aviso inválido');
  }
  const digest = createHash('sha256').update(JSON.stringify([evento.claveUnica, evento.usuarioId])).digest('hex');
  const reserva = await tx.identidadAviso.createMany({ data: [{ digest }], skipDuplicates: true });
  if (!reserva.count) return false;
  const preferencia = await tx.preferenciaNotificacion.findUnique({
    where: { usuarioId_tipo: { usuarioId: evento.usuarioId, tipo: evento.tipo } }, select: { inApp: true },
  });
  if (evento.tipo !== 'MENCION' && preferencia?.inApp !== true) return false;
  const titulos = { MENCION: 'Te mencionaron', COMENTARIO: 'Nuevo comentario', TAREA_ASIGNADA: 'Tarea asignada', TAREA_POR_VENCER: 'Tarea por vencer', TAREA_VENCIDA: 'Tarea vencida' };
  // Legacy legítimo: conservarlo sin duplicar, nunca acreditar pertenencia desde JSON.
  if (evento.comentarioId && await tx.notificacion.findFirst({ where: {
    usuarioId: evento.usuarioId, comentarioId: evento.comentarioId, tipo: evento.tipo,
    comentario: { is: { tareaId: evento.tareaId, ...(evento.tipo === 'MENCION' ? { menciones: { some: { usuarioId: evento.usuarioId } } } : {}) } },
  } })) return false;
  await tx.notificacion.create({ data: { usuarioId: evento.usuarioId, tipo: evento.tipo,
    titulo: titulos[evento.tipo], cuerpo: null, tareaId: evento.tareaId, comentarioId: evento.comentarioId ?? null } });
  return true;
}
