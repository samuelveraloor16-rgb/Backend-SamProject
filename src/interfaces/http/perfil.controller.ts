import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { PerfilService } from '../../aplicacion/perfil/perfil.service';
import { ActualizarPerfilDto } from '../../aplicacion/dtos/actualizar-perfil.dto';
import { CambiarPasswordDto } from '../../aplicacion/dtos/cambiar-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';

@Controller('perfil')
@UseGuards(JwtAuthGuard)
export class PerfilController {
  constructor(private readonly perfil: PerfilService) {}

  // RF-04
  @Get()
  async obtener(@CurrentUser() usuario: UsuarioAutenticado) {
    return this.perfil.obtener(usuario.id);
  }

  @Patch()
  async actualizar(@CurrentUser() usuario: UsuarioAutenticado, @Body() dto: ActualizarPerfilDto) {
    return this.perfil.actualizar(usuario.id, dto);
  }

  @Patch('contrasena')
  @HttpCode(HttpStatus.OK)
  async cambiarContrasena(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Body() dto: CambiarPasswordDto,
  ) {
    return this.perfil.cambiarPassword(usuario.id, dto);
  }
}
