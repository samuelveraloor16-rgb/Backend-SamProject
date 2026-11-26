import type { CandidatoVencimiento, VencimientosRepository } from '../../dominio/puertos/vencimientos.repository';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaPushOutboxRepository } from './prisma-push-outbox.repository';
import { registrarAviso } from './prisma-inapp.repository';

export class PrismaVencimientosRepository implements VencimientosRepository {
  constructor(private readonly prisma: PrismaService) {}

  async candidatos(ahora: Date, despuesDe: string | undefined, limite: number): Promise<CandidatoVencimiento[]> {
    if (!Number.isFinite(ahora.getTime()) || !Number.isInteger(limite) || limite < 1 || limite > 100) throw new RangeError('Escaneo inválido');
    const filas = await this.prisma.tarea.findMany({
      where: { ...(despuesDe === undefined ? {} : { id: { gt: despuesDe } }),
        responsableId: { not: null }, estado: { not: 'HECHA' },
        fechaLimite: { lte: new Date(ahora.getTime() + 86400000) },
        proyecto: { archivado: false, eliminadoEn: null } },
      select: { id: true, responsableId: true, fechaLimite: true }, orderBy: { id: 'asc' }, take: limite,
    });
    return filas as CandidatoVencimiento[];
  }

  async encolarVigente(c: CandidatoVencimiento, ahora: Date): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      // Bloquea las filas que justifican elegibilidad hasta el commit. Borrado,
      // archivo, reasignación y revocación no invalidan la lectura antes del insert.
      const bloqueadas = await tx.$queryRaw<{ id: string }[]>`SELECT t."id" FROM "tareas" t
        JOIN "proyectos" p ON p."id" = t."proyectoId"
        JOIN "membresias" m ON m."espacioId" = p."espacioId" AND m."usuarioId" = ${c.responsableId}
        WHERE t."id" = ${c.id} FOR SHARE OF t, p, m`;
      if (!bloqueadas.length) return false;
      const tarea = await tx.tarea.findFirst({
        where: { id: c.id, responsableId: c.responsableId, fechaLimite: c.fechaLimite,
          estado: { not: 'HECHA' }, proyecto: { archivado: false, eliminadoEn: null,
            espacio: { membresias: { some: { usuarioId: c.responsableId } } } } },
        select: { id: true, fechaLimite: true },
      });
      if (!tarea?.fechaLimite || tarea.fechaLimite.getTime() - 86400000 > ahora.getTime()) return false;
      const vencida = tarea.fechaLimite.getTime() <= ahora.getTime();
      const evento = {
        claveUnica: `${vencida ? 'vencfin' : 'venc24'}:${c.id}:${c.responsableId}:${tarea.fechaLimite.toISOString()}`,
        usuarioId: c.responsableId, tareaId: c.id, tipo: vencida ? 'TAREA_VENCIDA' as const : 'TAREA_POR_VENCER' as const,
      };
      await registrarAviso(tx, evento);
      return new PrismaPushOutboxRepository(this.prisma).enTransaccion(tx).encolar(evento);
    }, { isolationLevel: 'Serializable' });
  }
}
