import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from '../../aplicacion/auth/auth.service';
import { RegistroUsuarioDto } from '../../aplicacion/dtos/registro-usuario.dto';
import { LoginDto } from '../../aplicacion/dtos/login.dto';
import { RecuperarPasswordDto } from '../../aplicacion/dtos/recuperar-password.dto';
import { RestablecerPasswordDto } from '../../aplicacion/dtos/restablecer-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';

// Endpoints sensibles: 5 peticiones/minuto por IP (además del límite global de 100/min).
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // RF-01
  @Post('registro')
  @Throttle(AUTH_THROTTLE)
  async registro(@Body() dto: RegistroUsuarioDto) {
    return this.auth.registro(dto);
  }

  // RF-02
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // RF-02: invalida el token en el servidor (tokenVersion++).
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() usuario: UsuarioAutenticado) {
    return this.auth.logout(usuario.id);
  }

  // RF-03 (paso 1). Respuesta siempre genérica.
  @Post('recuperar')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async recuperar(@Body() dto: RecuperarPasswordDto) {
    return this.auth.recuperar(dto);
  }

  // RF-03 (paso 2)
  @Post('restablecer')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async restablecer(@Body() dto: RestablecerPasswordDto) {
    return this.auth.restablecer(dto);
  }
}
