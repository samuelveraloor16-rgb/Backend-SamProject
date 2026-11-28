import { Body, Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { HISTORIAL_REPOSITORY, type HistorialRepository } from '../../dominio/puertos/historial.repository';
import { CurrentUser, UsuarioAutenticado } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
@Controller()
@UseGuards(JwtAuthGuard)
export class HistorialController {
  constructor(@Inject(HISTORIAL_REPOSITORY) private readonly historial: HistorialRepository) {}
  @Get('proyectos/:id/historial')
  proyecto(@Param('id') id: string, @CurrentUser() usuario: UsuarioAutenticado, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    return this.historial.listar('PROYECTO', id, usuario.id, query, body);
  }
  @Get('tareas/:id/historial')
  tarea(@Param('id') id: string, @CurrentUser() usuario: UsuarioAutenticado, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    return this.historial.listar('TAREA', id, usuario.id, query, body);
  }
}
