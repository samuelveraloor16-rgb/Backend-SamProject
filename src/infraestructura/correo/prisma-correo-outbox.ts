import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import type { EventoCorreo, ReservaCorreo, ResultadoCorreo } from '../../dominio/puertos/correo-eventos';
import { siguienteCorreo } from '../../aplicacion/correo/correo-dispatcher';

export function identidadCorreo(evento: Pick<EventoCorreo, 'claveUnica' | 'usuarioId'>): string {
  return createHash('sha256').update(JSON.stringify(['correo', evento.claveUnica, evento.usuarioId])).digest('hex');
}

/** Helper preparado para transacciones de negocio; NO conectado aún a hooks.
 * Quien lo integre debe reutilizar evento/destinatario e instante ORIGINAL. */
export async function registrarCorreo(tx: Prisma.TransactionClient, evento: EventoCorreo): Promise<boolean> {
  if (!evento.claveUnica || !evento.usuarioId || !evento.tareaId || !Number.isFinite(evento.ocurridoEn.getTime())
    || !['TAREA_ASIGNADA', 'TAREA_POR_VENCER', 'TAREA_VENCIDA', 'COMENTARIO', 'MENCION'].includes(evento.tipo)
    || ['COMENTARIO', 'MENCION'].includes(evento.tipo) !== Boolean(evento.comentarioId)) throw new Error('Evento correo inválido');
  const digest = identidadCorreo(evento);
  const reserva = await tx.identidadCorreo.createMany({ data: [{ digest }], skipDuplicates: true });
  if (!reserva.count) return false;
  const frontera = await tx.fronteraCorreo.findUnique({ where: { id: 1 } });
  if (!frontera) throw new Error('Frontera correo no disponible');
  // Incluso eventos históricos/suprimidos consumen identidad sin generar envío.
  if (evento.ocurridoEn < frontera.desde) return false;
  const preferencia = await tx.preferenciaNotificacion.findUnique({
    where: { usuarioId_tipo: { usuarioId: evento.usuarioId, tipo: evento.tipo } }, select: { correo: true },
  });
  if (preferencia?.correo !== true) return false;
  await tx.correoOutbox.create({ data: { digest, usuarioId: evento.usuarioId, tareaId: evento.tareaId,
    comentarioId: evento.comentarioId ?? null, tipo: evento.tipo, ocurridoEn: evento.ocurridoEn } });
  return true;
}

/** Primitivas SQL: caller mantiene locks de elegibilidad hasta confirmar EN_IO.
 * No constituyen adaptador de despacho: falta elegibilidad productiva completa. */
export async function iniciarIoCorreo(tx: Prisma.TransactionClient, digest: string, generacion: string): Promise<ReservaCorreo | null> {
  if (!generacion) throw new Error('Generación requerida');
  // Adquirir primero el lock: el reloj de la sentencia UPDATE se evalúa después
  // de la espera, no antes de bloquear sobre otra generación.
  await tx.$queryRaw`SELECT "digest" FROM "correo_outbox" WHERE "digest" = ${digest} FOR UPDATE`;
  const filas = await tx.$queryRaw<ReservaCorreo[]>`UPDATE "correo_outbox"
    SET "estado" = 'EN_IO', "intentos" = "intentos" + 1, "generacion" = ${generacion},
      "leaseHasta" = clock_timestamp() + interval '2 minutes'
    WHERE "digest" = ${digest} AND "estado" = 'PENDIENTE' AND "intentos" < 6
      AND "proximoIntentoEn" <= clock_timestamp()
    RETURNING "digest", "generacion", "intentos", "usuarioId"`;
  return filas[0] ?? null;
}
export async function recuperarIoCorreo(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`UPDATE "correo_outbox" SET "estado" = 'INCIERTO', "generacion" = NULL, "leaseHasta" = NULL
    WHERE "estado" = 'EN_IO' AND "leaseHasta" <= clock_timestamp()`;
}
export async function finalizarIoCorreo(tx: Prisma.TransactionClient, reserva: ReservaCorreo, resultado: ResultadoCorreo): Promise<boolean> {
  const cambio = siguienteCorreo(reserva.intentos, resultado);
  const n = await tx.$executeRaw`UPDATE "correo_outbox" SET "estado" = ${cambio.estado},
    "generacion" = NULL, "leaseHasta" = NULL,
    "proximoIntentoEn" = clock_timestamp() + (${cambio.esperaMs} * interval '1 millisecond')
    WHERE "digest" = ${reserva.digest} AND "estado" = 'EN_IO' AND "generacion" = ${reserva.generacion}
      AND "intentos" = ${reserva.intentos} AND "leaseHasta" > clock_timestamp()`;
  return n === 1;
}
