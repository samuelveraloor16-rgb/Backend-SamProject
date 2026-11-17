import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { TokenService, JwtPayload } from '../../dominio/puertos/token-service.port';

@Injectable()
export class JwtTokenService implements TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  firmar(payload: JwtPayload): string {
    // La expiración se aplica vía signOptions del JwtModule (JWT_EXPIRES_IN).
    return this.jwt.sign(payload);
  }
}
