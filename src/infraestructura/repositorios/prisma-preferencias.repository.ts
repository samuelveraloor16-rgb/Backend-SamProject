import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CambioPreferencia, PreferenciaNotificacion, PreferenciasRepository, TIPOS_PREFERENCIA } from '../../dominio/puertos/preferencias.repository';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class PrismaPreferenciasRepository implements PreferenciasRepository {
  constructor(private readonly prisma: PrismaService) {}
  listar(usuarioId: string): Promise<PreferenciaNotificacion[]> {
    return this.prisma.preferenciaNotificacion.findMany({ where: { usuarioId }, select: { tipo: true, inApp: true, correo: true, push: true } });
  }
  actualizar(usuarioId: string, cambios: CambioPreferencia[]): Promise<PreferenciaNotificacion[]> {
    return this.prisma.$transaction(async tx => {
      for (const cambio of [...cambios].sort((a, b) => TIPOS_PREFERENCIA.indexOf(a.tipo) - TIPOS_PREFERENCIA.indexOf(b.tipo))) {
        const updates: Prisma.Sql[] = [];
        if (cambio.inApp !== undefined) updates.push(Prisma.sql`"inApp" = EXCLUDED."inApp"`);
        if (cambio.correo !== undefined) updates.push(Prisma.sql`"correo" = EXCLUDED."correo"`);
        if (cambio.push !== undefined) updates.push(Prisma.sql`"push" = EXCLUDED."push"`);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "preferencias_notificaciones" ("usuarioId", "tipo", "inApp", "correo", "push")
          VALUES (${usuarioId}, ${cambio.tipo}::"TipoPreferenciaNotificacion", ${cambio.inApp ?? (cambio.tipo === 'MENCION')}, ${cambio.correo ?? false}, ${cambio.push ?? true})
          ON CONFLICT ("usuarioId", "tipo") DO UPDATE SET ${Prisma.join(updates)}
        `);
      }
      return tx.preferenciaNotificacion.findMany({ where: { usuarioId }, select: { tipo: true, inApp: true, correo: true, push: true } });
    });
  }
}
