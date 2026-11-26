import { BadRequestException, Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { PreferenciasService } from '../../aplicacion/perfil/preferencias.service';
import { PreferenciasPipe } from '../../aplicacion/dtos/preferencias.dto';
import { CambioPreferencia } from '../../dominio/puertos/preferencias.repository';
import { CurrentUser, UsuarioAutenticado } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('perfil/preferencias-notificaciones')
@UseGuards(JwtAuthGuard)
export class PreferenciasController {
  constructor(private readonly preferencias: PreferenciasService) {}
  private vacio(value: unknown) {
    if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length)) {
      throw new BadRequestException('Preferencias de notificaciones inválidas');
    }
  }
  @Get()
  obtener(@CurrentUser() usuario: UsuarioAutenticado, @Query() query: unknown, @Body() body: unknown) {
    this.vacio(query); this.vacio(body);
    return this.preferencias.obtener(usuario.id);
  }
  @Patch()
  actualizar(@CurrentUser() usuario: UsuarioAutenticado, @Query() query: unknown, @Body(PreferenciasPipe) cambios: CambioPreferencia[]) {
    this.vacio(query);
    return this.preferencias.actualizar(usuario.id, cambios);
  }
}
