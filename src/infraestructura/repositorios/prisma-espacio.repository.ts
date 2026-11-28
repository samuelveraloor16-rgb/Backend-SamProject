import { Injectable } from '@nestjs/common';
import { appendHistorial } from './prisma-historial-append';
import type {
  EspacioRepository,
  EspacioEntity,
  EspacioConMembresia,
  MembresiaEntity,
  InvitacionEntity,
  DatosCrearInvitacion,
  RolEspacio,
} from '../../dominio/puertos/espacio.repository';
import { PrismaService } from '../prisma/prisma.service';

function aEspacio(e: {
  id: string;
  nombre: string;
  esPersonal: boolean;
  asistenteActivo: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
}): EspacioEntity {
  return { ...e };
}

function aMembresia(m: {
  id: string;
  usuarioId: string;
  espacioId: string;
  rol: string;
  creadoEn: Date;
}): MembresiaEntity {
  return { ...m, rol: m.rol as RolEspacio };
}

function aInvitacion(i: {
  id: string;
  tokenHash: string;
  email: string;
  rol: string;
  espacioId: string;
  invitadoPorId: string | null;
  expiraEn: Date;
  aceptadaEn: Date | null;
  creadoEn: Date;
}): InvitacionEntity {
  return { ...i, rol: i.rol as RolEspacio };
}

@Injectable()
export class PrismaEspacioRepository implements EspacioRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listarDeUsuario(usuarioId: string): Promise<EspacioConMembresia[]> {
    const membresias = await this.prisma.membresia.findMany({
      where: { usuarioId },
      include: { espacio: true },
    });
    const espacioIds = membresias.map((m) => m.espacioId);
    const conteos = await this.prisma.membresia.groupBy({
      by: ['espacioId'],
      where: { espacioId: { in: espacioIds } },
      _count: { _all: true },
    });
    const totalPorEspacio = new Map(conteos.map((c) => [c.espacioId, c._count._all]));
    return membresias.map((m) => ({
      espacio: aEspacio(m.espacio),
      miRol: m.rol as RolEspacio,
      totalMiembros: totalPorEspacio.get(m.espacioId) ?? 1,
    }));
  }

  async buscarPorId(id: string): Promise<EspacioEntity | null> {
    const e = await this.prisma.espacioDeTrabajo.findUnique({ where: { id } });
    return e ? aEspacio(e) : null;
  }

  async obtenerMembresia(espacioId: string, usuarioId: string): Promise<MembresiaEntity | null> {
    const m = await this.prisma.membresia.findUnique({
      where: { usuarioId_espacioId: { usuarioId, espacioId } },
    });
    return m ? aMembresia(m) : null;
  }

  async crearConAdmin(datos: { nombre: string; creadorId: string }): Promise<EspacioEntity> {
    const espacio = await this.prisma.$transaction(async (tx) => {
      const nuevo = await tx.espacioDeTrabajo.create({
        data: { nombre: datos.nombre, esPersonal: false },
      });
      await tx.membresia.create({
        data: { usuarioId: datos.creadorId, espacioId: nuevo.id, rol: 'ADMINISTRADOR' },
      });
      const bandeja = await tx.proyecto.create({
        data: { nombre: 'Bandeja de entrada', esBandejaDeEntrada: true, espacioId: nuevo.id },
      });
      await appendHistorial(tx, { entidad: 'PROYECTO', entidadId: bandeja.id, proyectoId: bandeja.id, espacioId: nuevo.id, usuarioId: datos.creadorId }, 'CREADO');
      return nuevo;
    });
    return aEspacio(espacio);
  }

  async actualizar(
    id: string,
    datos: { nombre?: string; asistenteActivo?: boolean },
  ): Promise<EspacioEntity> {
    const e = await this.prisma.espacioDeTrabajo.update({
      where: { id },
      data: {
        ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
        ...(datos.asistenteActivo !== undefined ? { asistenteActivo: datos.asistenteActivo } : {}),
      },
    });
    return aEspacio(e);
  }

  contarMiembros(espacioId: string): Promise<number> {
    return this.prisma.membresia.count({ where: { espacioId } });
  }

  contarAdministradores(espacioId: string): Promise<number> {
    return this.prisma.membresia.count({ where: { espacioId, rol: 'ADMINISTRADOR' } });
  }

  async buscarUsuarioPorEmail(email: string): Promise<{ id: string; email: string } | null> {
    const u = await this.prisma.usuario.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    return u;
  }

  async crearInvitacion(datos: DatosCrearInvitacion): Promise<InvitacionEntity> {
    const i = await this.prisma.invitacion.create({ data: datos });
    return aInvitacion(i);
  }

  async buscarInvitacionPorTokenHash(tokenHash: string): Promise<InvitacionEntity | null> {
    const i = await this.prisma.invitacion.findUnique({ where: { tokenHash } });
    return i ? aInvitacion(i) : null;
  }

  async aceptarInvitacion(datos: {
    invitacionId: string;
    usuarioId: string;
    espacioId: string;
    rol: RolEspacio;
  }): Promise<MembresiaEntity> {
    const [, membresia] = await this.prisma.$transaction([
      this.prisma.invitacion.update({
        where: { id: datos.invitacionId },
        data: { aceptadaEn: new Date() },
      }),
      this.prisma.membresia.create({
        data: { usuarioId: datos.usuarioId, espacioId: datos.espacioId, rol: datos.rol },
      }),
    ]);
    return aMembresia(membresia);
  }

  async actualizarRolMembresia(
    espacioId: string,
    usuarioId: string,
    rol: RolEspacio,
  ): Promise<MembresiaEntity | null> {
    const existente = await this.prisma.membresia.findUnique({
      where: { usuarioId_espacioId: { usuarioId, espacioId } },
    });
    if (!existente) return null;
    const m = await this.prisma.membresia.update({
      where: { usuarioId_espacioId: { usuarioId, espacioId } },
      data: { rol },
    });
    return aMembresia(m);
  }

  async eliminarMembresia(espacioId: string, usuarioId: string): Promise<boolean> {
    const resultado = await this.prisma.membresia.deleteMany({
      where: { espacioId, usuarioId },
    });
    return resultado.count > 0;
  }
}
