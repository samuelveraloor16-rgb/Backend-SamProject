import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  USUARIO_REPOSITORY,
  type UsuarioRepository,
  type UsuarioEntity,
  type DatosActualizarPerfil,
} from '../../dominio/puertos/usuario.repository';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../../dominio/puertos/password-hasher.port';
import { ActualizarPerfilDto } from '../dtos/actualizar-perfil.dto';
import { CambiarPasswordDto } from '../dtos/cambiar-password.dto';

export interface PerfilPublico {
  id: string;
  email: string;
  nombre: string;
  fotoUrl: string | null;
  creadoEn: Date;
}

function aPerfil(u: UsuarioEntity): PerfilPublico {
  return { id: u.id, email: u.email, nombre: u.nombre, fotoUrl: u.fotoUrl, creadoEn: u.creadoEn };
}

@Injectable()
export class PerfilService {
  constructor(
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async obtener(usuarioId: string): Promise<PerfilPublico> {
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (!usuario) {
      throw new UnauthorizedException('Usuario no encontrado');
    }
    return aPerfil(usuario);
  }

  async actualizar(usuarioId: string, dto: ActualizarPerfilDto): Promise<PerfilPublico> {
    if (dto.nombre === undefined && dto.fotoUrl === undefined) {
      throw new BadRequestException('No hay cambios que aplicar');
    }
    const datos: DatosActualizarPerfil = {};
    if (dto.nombre !== undefined) datos.nombre = dto.nombre.trim();
    // '' o null explícito borran la foto
    if (dto.fotoUrl !== undefined) datos.fotoUrl = dto.fotoUrl === '' ? null : dto.fotoUrl;
    const usuario = await this.usuarios.actualizarPerfil(usuarioId, datos);
    return aPerfil(usuario);
  }

  // RF-04: cambio de contraseña requiere la actual. Invalida todas las sesiones (tokenVersion++).
  async cambiarPassword(
    usuarioId: string,
    dto: CambiarPasswordDto,
  ): Promise<{ mensaje: string }> {
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (!usuario) {
      throw new UnauthorizedException('Usuario no encontrado');
    }
    const ok = await this.hasher.comparar(dto.contrasenaActual, usuario.passwordHash);
    if (!ok) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    const passwordHash = await this.hasher.hash(dto.contrasenaNueva);
    await this.usuarios.actualizarPasswordDesdePerfil(usuarioId, passwordHash);
    return { mensaje: 'Contraseña actualizada. Inicia sesión nuevamente.' };
  }
}
