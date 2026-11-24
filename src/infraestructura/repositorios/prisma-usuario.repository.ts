import { Injectable } from '@nestjs/common';
import type {
  UsuarioRepository,
  UsuarioEntity,
  DatosRegistroConEspacio,
  DatosActualizarPerfil,
} from '../../dominio/puertos/usuario.repository';
import { PrismaService } from '../prisma/prisma.service';

function aEntidad(u: {
  id: string;
  email: string;
  nombre: string;
  fotoUrl: string | null;
  passwordHash: string;
  tokenVersion: number;
  resetTokenHash: string | null;
  resetTokenExpires: Date | null;
  creadoEn: Date;
  actualizadoEn: Date;
}): UsuarioEntity {
  return { ...u };
}

@Injectable()
export class PrismaUsuarioRepository implements UsuarioRepository {
  constructor(private readonly prisma: PrismaService) {}

  buscarPorEmail(email: string): Promise<UsuarioEntity | null> {
    return this.prisma.usuario
      .findUnique({ where: { email } })
      .then((u) => (u ? aEntidad(u) : null));
  }

  buscarPorId(id: string): Promise<UsuarioEntity | null> {
    return this.prisma.usuario.findUnique({ where: { id } }).then((u) => (u ? aEntidad(u) : null));
  }

  // RF-01/RF-05/RF-13: alta completa en una transacción.
  async crearConEspacioPersonal(datos: DatosRegistroConEspacio): Promise<UsuarioEntity> {
    const usuario = await this.prisma.$transaction(async (tx) => {
      const creado = await tx.usuario.create({
        data: { nombre: datos.nombre, email: datos.email, passwordHash: datos.passwordHash },
      });
      const espacio = await tx.espacioDeTrabajo.create({
        data: { nombre: `Espacio de ${datos.nombre}`, esPersonal: true },
      });
      await tx.membresia.create({
        data: { usuarioId: creado.id, espacioId: espacio.id, rol: 'ADMINISTRADOR' },
      });
      await tx.proyecto.create({
        data: {
          nombre: 'Bandeja de entrada',
          esBandejaDeEntrada: true,
          espacioId: espacio.id,
        },
      });
      return creado;
    });
    return aEntidad(usuario);
  }

  async actualizarPerfil(id: string, datos: DatosActualizarPerfil): Promise<UsuarioEntity> {
    const usuario = await this.prisma.usuario.update({
      where: { id },
      data: {
        ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
        ...(datos.fotoUrl !== undefined ? { fotoUrl: datos.fotoUrl } : {}),
      },
    });
    return aEntidad(usuario);
  }

  // RF-03: reset de contraseña. Limpia el token y invalida sesiones.
  async restablecerPassword(id: string, tokenHash: string, passwordHash: string): Promise<number> {
    return this.prisma.$transaction(async tx => {
      // Se toma el bloqueo antes de evaluar el reloj: puede esperarse más que la vida restante del token.
      await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${id} FOR UPDATE`;
      // Prisma almacena DateTime como timestamp sin zona en UTC, con precisión de milisegundos.
      return tx.$executeRaw`
        UPDATE usuarios SET "passwordHash" = ${passwordHash}, "resetTokenHash" = NULL,
          "resetTokenExpires" = NULL, "tokenVersion" = "tokenVersion" + 1,
          "actualizadoEn" = date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')
        WHERE id = ${id} AND "resetTokenHash" = ${tokenHash}
          AND "resetTokenExpires" >= date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')
      `;
    });
  }

  // RF-04: cambio desde perfil. Invalida sesiones.
  async actualizarPasswordDesdePerfil(id: string, passwordHash: string): Promise<void> {
    await this.prisma.usuario.update({
      where: { id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
  }

  async incrementarTokenVersion(id: string): Promise<void> {
    await this.prisma.usuario.update({
      where: { id },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async guardarResetToken(id: string, tokenHash: string, expira: Date): Promise<void> {
    await this.prisma.usuario.update({
      where: { id },
      data: { resetTokenHash: tokenHash, resetTokenExpires: expira },
    });
  }

  buscarPorResetTokenHash(tokenHash: string): Promise<UsuarioEntity | null> {
    return this.prisma.usuario
      .findFirst({ where: { resetTokenHash: tokenHash } })
      .then((u) => (u ? aEntidad(u) : null));
  }
}
