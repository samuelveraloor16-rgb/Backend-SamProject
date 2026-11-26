import type { Prisma } from '@prisma/client';
import type { PushDispatchRepository, VinculoPush } from '../../dominio/puertos/push-dispatch.repository';
import type { PushAlmacenado, CambioPush, TipoPush } from '../../dominio/puertos/push-outbox.repository';
import type { PushPayload } from '../../dominio/puertos/push-provider';
import { PrismaService } from '../prisma/prisma.service';

const textos: Record<TipoPush, [string, string]> = {
  TAREA_ASIGNADA: ['Tarea asignada', 'Se te asignó una tarea'],
  TAREA_POR_VENCER: ['Tarea por vencer', 'Una tarea vence en 24 horas'],
  TAREA_VENCIDA: ['Tarea vencida', 'Una tarea llegó a su fecha límite'],
  MENCION: ['Te mencionaron', 'Te mencionaron en un comentario'],
  COMENTARIO: ['Nuevo comentario', 'Nuevo comentario en una tarea que sigues'],
};
const whereVinculo = (v: VinculoPush) => ({ id: v.id, usuarioId: v.usuarioId, tokenPush: v.tokenPush, tokenVersionVinculado: v.tokenVersionVinculado, actualizadoEn: v.actualizadoEn });
const whereIntento = (id: string, v: VinculoPush) => ({ outboxId: id, dispositivoId: v.id, usuarioId: v.usuarioId, vinculoEn: v.actualizadoEn });

export class PrismaPushDispatchRepository implements PushDispatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  reclamar(fila: PushAlmacenado, _ahora: Date): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      await this.bloquear(tx, fila.usuarioId);
      // Reloj compartido entre procesos; el reloj del worker solo preselecciona.
      const [{ ahora }] = await tx.$queryRaw<[{ ahora: Date }]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS ahora`;
      // No solapar dos filas del mismo destinatario. Lease recuperable tras caída.
      const vuelo = await tx.pushOutbox.count({ where: { usuarioId: fila.usuarioId, estado: 'PENDIENTE', intentos: { gt: 0 }, proximoIntentoEn: { gt: ahora } } });
      if (vuelo) return false;
      if (fila.intentos >= 5) {
        await tx.pushOutbox.updateMany({ where: { id: fila.id, estado: 'PENDIENTE', intentos: fila.intentos, proximoIntentoEn: { lte: ahora } }, data: { estado: 'FALLIDO' } });
        return false;
      }
      return (await tx.pushOutbox.updateMany({ where: { id: fila.id, estado: 'PENDIENTE', intentos: fila.intentos, proximoIntentoEn: { lte: ahora } },
        data: { intentos: { increment: 1 }, proximoIntentoEn: new Date(ahora.getTime() + 120000) } })).count === 1;
    });
  }
  dispositivos(usuarioId: string): Promise<VinculoPush[]> {
    return this.prisma.dispositivo.findMany({ where: { usuarioId }, select: { id: true, usuarioId: true, tokenPush: true, tokenVersionVinculado: true, actualizadoEn: true }, orderBy: { id: 'asc' } });
  }

  async revalidar(fila: PushAlmacenado, v: VinculoPush): Promise<PushPayload | null | 'LIMITADO'> {
    if (fila.usuarioId !== v.usuarioId) return null;
    return this.prisma.$transaction(async tx => {
      await this.bloquear(tx, fila.usuarioId);
      const [{ ahora }] = await tx.$queryRaw<[{ ahora: Date }]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS ahora`;
      const claim = await tx.pushOutbox.findFirst({ where: { id: fila.id, estado: 'PENDIENTE', intentos: fila.intentos + 1, proximoIntentoEn: { gt: ahora } }, select: { id: true } });
      if (!claim) return null;
      // Lectura fresca por dispositivo e intento, antes de reservar frecuencia/I/O.
      // Errores se propagan: el dispatcher conserva el lease y no envía.
      const preferencia = await tx.preferenciaNotificacion.findUnique({
        where: { usuarioId_tipo: { usuarioId: fila.usuarioId, tipo: fila.tipo } }, select: { push: true },
      });
      if (preferencia?.push === false) return null;
      const d = await tx.dispositivo.findFirst({ where: whereVinculo(v), select: { usuario: { select: { tokenVersion: true } } } });
      if (!d || d.usuario.tokenVersion !== v.tokenVersionVinculado) return null;
      const tarea = await tx.tarea.findFirst({ where: { id: fila.tareaId, proyecto: { eliminadoEn: null, espacio: { membresias: { some: { usuarioId: fila.usuarioId } } } } },
        select: { proyectoId: true, responsableId: true, estado: true, fechaLimite: true, proyecto: { select: { espacioId: true, archivado: true } } } });
      if (!tarea) return null;
      if (fila.tipo === 'COMENTARIO' || fila.tipo === 'MENCION') {
        if (!fila.comentarioId) return null;
        const c = await tx.comentario.findFirst({ where: { id: fila.comentarioId, tareaId: fila.tareaId, autorId: { not: fila.usuarioId } }, select: { menciones: { where: { usuarioId: fila.usuarioId }, select: { usuarioId: true } } } });
        if (!c || (fila.tipo === 'MENCION' ? !c.menciones.length : tarea.responsableId !== fila.usuarioId)) return null;
      } else {
        if (tarea.responsableId !== fila.usuarioId || tarea.proyecto.archivado) return null;
        if (fila.tipo !== 'TAREA_ASIGNADA') {
          if (tarea.estado === 'HECHA' || !tarea.fechaLimite) return null;
          const prefijo = fila.tipo === 'TAREA_POR_VENCER' ? 'venc24' : 'vencfin';
          // Legacy sin destinatario: fail-closed, nunca reinterpretar/transferir.
          if (fila.claveUnica !== `${prefijo}:${fila.tareaId}:${fila.usuarioId}:${tarea.fechaLimite.toISOString()}`) return null;
          if (tarea.fechaLimite.getTime() - (prefijo === 'venc24' ? 86400000 : 0) > ahora.getTime()) return null;
          if (prefijo === 'venc24' && tarea.fechaLimite.getTime() <= ahora.getTime()) return null;
        }
      }
      if (await tx.pushIntento.count({ where: { usuarioId: fila.usuarioId, creadoEn: { gt: new Date(ahora.getTime() - 60000) } } }) >= 10) return 'LIMITADO';
      // Reserva frecuencia en la misma sección crítica, antes de CADA I/O externo.
      await tx.pushIntento.create({ data: { ...whereIntento(fila.id, v), creadoEn: ahora } });
      return { to: v.tokenPush, title: textos[fila.tipo][0], body: textos[fila.tipo][1], data: { tipo: fila.tipo, tareaId: fila.tareaId, proyectoId: tarea.proyectoId, espacioId: tarea.proyecto.espacioId, comentarioId: fila.comentarioId ?? null } };
    });
  }

  async aceptado(id: string, v: VinculoPush) {
    // Refrescar el vínculo de la misma cuenta no vuelve a enviar un evento
    // ya aceptado a ese dispositivo. La generación sí protege las escrituras.
    return (await this.prisma.pushIntento.count({ where: { outboxId: id, dispositivoId: v.id, usuarioId: v.usuarioId, aceptado: true } })) > 0;
  }
  async rechazado(id: string, v: VinculoPush) { return (await this.prisma.pushIntento.count({ where: { ...whereIntento(id, v), rechazado: true } })) > 0; }
  async registrarRechazado(id: string, v: VinculoPush) {
    await this.prisma.pushIntento.updateMany({ where: whereIntento(id, v), data: { rechazado: true } });
  }
  async registrarAceptado(id: string, v: VinculoPush) {
    await this.prisma.pushIntento.updateMany({ where: whereIntento(id, v), data: { aceptado: true } });
    // No tocar actualizadoEn: es la generación del vínculo, no la hora de envío.
    await this.prisma.$executeRaw`UPDATE "dispositivos" SET "ultimoEnvioEn" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE "id" = ${v.id} AND "usuarioId" = ${v.usuarioId} AND "tokenPush" = ${v.tokenPush} AND "tokenVersionVinculado" = ${v.tokenVersionVinculado} AND "actualizadoEn" = ${v.actualizadoEn}`;
  }
  async revocar(v: VinculoPush) { await this.prisma.dispositivo.deleteMany({ where: whereVinculo(v) }); }
  async finalizar(id: string, intento: number, cambio: CambioPush) {
    return (await this.prisma.pushOutbox.updateMany({ where: { id, estado: 'PENDIENTE', intentos: intento }, data: cambio })).count === 1;
  }
  private async bloquear(tx: Prisma.TransactionClient, usuarioId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push:${usuarioId}`}, 0))::text`;
  }
}
