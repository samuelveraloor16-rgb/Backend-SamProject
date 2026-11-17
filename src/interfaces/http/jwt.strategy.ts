import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  USUARIO_REPOSITORY,
  type UsuarioRepository,
} from '../../dominio/puertos/usuario.repository';
import type { JwtPayload } from '../../dominio/puertos/token-service.port';
import type { UsuarioAutenticado } from './current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepository,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET no está definida. Revisa tu .env (ver .env.example).');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // RF-02: además de firma/expiración, el token solo es válido si tokenVersion coincide con la BD.
  async validate(payload: JwtPayload): Promise<UsuarioAutenticado> {
    const usuario = await this.usuarios.buscarPorId(payload.sub);
    if (!usuario) {
      throw new UnauthorizedException('La cuenta ya no existe');
    }
    if (usuario.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Sesión invalidada. Inicia sesión nuevamente.');
    }
    return { id: usuario.id, email: usuario.email, nombre: usuario.nombre };
  }
}
