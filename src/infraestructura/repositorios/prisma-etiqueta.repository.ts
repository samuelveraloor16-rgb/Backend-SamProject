import { Injectable } from '@nestjs/common';
import type { EtiquetaEntity, EtiquetaRepository } from '../../dominio/puertos/etiqueta.repository';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaEtiquetaRepository implements EtiquetaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listarPorEspacio(espacioId: string): Promise<EtiquetaEntity[]> {
    const filas = await this.prisma.etiqueta.findMany({
      where: { espacioId },
      orderBy: { nombre: 'asc' },
    });
    return filas.map((f) => ({ ...f }));
  }

  async crear(datos: {
    nombre: string;
    color: string | null;
    espacioId: string;
  }): Promise<EtiquetaEntity> {
    const f = await this.prisma.etiqueta.create({ data: datos });
    return { ...f };
  }

  async buscarPorIdsEnEspacio(espacioId: string, ids: string[]): Promise<EtiquetaEntity[]> {
    if (ids.length === 0) return [];
    const filas = await this.prisma.etiqueta.findMany({
      where: { espacioId, id: { in: ids } },
    });
    return filas.map((f) => ({ ...f }));
  }

  async existeNombreEnEspacio(espacioId: string, nombre: string): Promise<boolean> {
    const f = await this.prisma.etiqueta.findFirst({
      where: { espacioId, nombre: { equals: nombre, mode: 'insensitive' } },
      select: { id: true },
    });
    return f !== null;
  }
}
