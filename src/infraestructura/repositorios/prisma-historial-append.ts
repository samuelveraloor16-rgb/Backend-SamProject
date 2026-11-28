import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { esDetalleGeneral } from '../../dominio/historial/detalle';

export interface ContextoCambio {
  entidad: 'PROYECTO' | 'TAREA'; entidadId: string; espacioId: string;
  proyectoId: string; tareaId?: string; usuarioId: string;
  proyectoOrigenId?: string; proyectoDestinoId?: string;
}
/** El único reloj es BD. El TransactionClient procede del escritor de negocio. */
export async function appendHistorial(tx: Prisma.TransactionClient, contexto: ContextoCambio, accion: string, detalle: Prisma.InputJsonObject = {}) {
  const movimiento = accion === 'MOVIDO' && contexto.entidad === 'TAREA'
    && contexto.proyectoOrigenId && contexto.proyectoDestinoId
    && contexto.proyectoOrigenId !== contexto.proyectoDestinoId && Object.keys(detalle).length === 0;
  if (!movimiento && !esDetalleGeneral(accion, detalle)) throw new Error('Detalle de historial inválido');
  const datos = movimiento ? { proyectoOrigenId: contexto.proyectoOrigenId!, proyectoDestinoId: contexto.proyectoDestinoId! } : detalle;
  // Fence corto exclusivamente BD: lector exclusivo espera commits de append;
  // escritores comparten fence y generan reloj DESPUÉS de adquirirlo.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(151613)`;
  // SQL parametrizado para no depender de un cliente generado previo a migración.
  await tx.$executeRaw`INSERT INTO "registro_de_cambios"
    ("id", "entidad", "entidadId", "accion", "detalle", "usuarioId", "creadoEn", "versionHistorial", "actorTipo", "espacioId", "proyectoId", "tareaId", "proyectoOrigenId", "proyectoDestinoId")
    VALUES (${randomUUID()}, ${contexto.entidad}, ${contexto.entidadId}, ${accion}, ${JSON.stringify(datos)}::jsonb,
      ${contexto.usuarioId}, date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC'), 1, 'USUARIO',
      ${contexto.espacioId}, ${contexto.proyectoId}, ${contexto.tareaId ?? null}, ${contexto.proyectoOrigenId ?? null}, ${contexto.proyectoDestinoId ?? null})`;
}
