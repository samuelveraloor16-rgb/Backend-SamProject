import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CambioPush, NuevoPush, PushAlmacenado, PushOutboxRepository } from '../../dominio/puertos/push-outbox.repository';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaPushOutboxRepository implements PushOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Permite encolar usando la misma transacción de tareas/comentarios existentes. */
  enTransaccion(tx: Prisma.TransactionClient): PushOutboxRepository {
    return {
      encolar: evento => this.insertar(tx, evento),
      pendientes: (hasta, limite) => this.leer(tx, hasta, limite),
      actualizar: (id, intentos, cambio) => this.cambiar(tx, id, intentos, cambio),
    };
  }

  encolar(evento: NuevoPush) { return this.insertar(this.prisma, evento); }
  pendientes(hasta: Date, limite: number) { return this.leer(this.prisma, hasta, limite); }
  actualizar(id: string, intentos: number, cambio: CambioPush) { return this.cambiar(this.prisma, id, intentos, cambio); }

  private async leer(db: Pick<Prisma.TransactionClient, 'pushOutbox'>, hasta: Date, limite: number): Promise<PushAlmacenado[]> {
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw new RangeError('Límite inválido');
    return db.pushOutbox.findMany({
      where: { estado: 'PENDIENTE', proximoIntentoEn: { lte: hasta } },
      orderBy: [{ proximoIntentoEn: 'asc' }, { id: 'asc' }], take: limite,
      select: { id: true, claveUnica: true, usuarioId: true, tipo: true, tareaId: true, comentarioId: true, intentos: true, proximoIntentoEn: true },
    }) as Promise<PushAlmacenado[]>;
  }

  private async cambiar(db: Pick<Prisma.TransactionClient, 'pushOutbox'>, id: string, intentos: number, cambio: CambioPush) {
    // Compare-and-set de almacenamiento; no calcula backoff ni envía al proveedor.
    return (await db.pushOutbox.updateMany({ where: { id, estado: 'PENDIENTE', intentos }, data: cambio })).count === 1;
  }

  private async insertar(db: Pick<Prisma.TransactionClient, 'pushOutbox' | 'preferenciaNotificacion'>, evento: NuevoPush) {
    const preferencia = await db.preferenciaNotificacion.findUnique({
      where: { usuarioId_tipo: { usuarioId: evento.usuarioId, tipo: evento.tipo } }, select: { push: true },
    });
    if (preferencia?.push === false) return false;
    // ON CONFLICT DO NOTHING (no P2002 capturado dentro de una transacción
    // PostgreSQL abortada). claveUnica no nullable deduplica incluso comentarioId NULL.
    const resultado = await db.pushOutbox.createMany({ data: [evento], skipDuplicates: true });
    return resultado.count === 1;
  }
}
