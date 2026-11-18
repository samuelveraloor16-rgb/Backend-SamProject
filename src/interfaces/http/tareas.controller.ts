import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TareasService } from '../../aplicacion/tareas/tareas.service';
import {
  ActualizarTareaDto,
  CambiarEstadoDto,
  CrearSubtareaDto,
  CrearTareaDto,
  ListarTareasQueryDto,
  MoverTareaDto,
  TareaRapidaDto,
} from '../../aplicacion/dtos/tarea-dtos';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class TareasController {
  constructor(private readonly tareas: TareasService) {}

  // RF-13: tarea rápida (máx. 2 toques). Declarada ANTES de 'tareas/:id'.
  @Post('tareas/rapida')
  rapida(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Body() dto: TareaRapidaDto,
  ) {
    return this.tareas.rapida(usuario.id, dto);
  }

  // RF-16/RF-17: lista con filtros. El Kanban consume este mismo listado (sin endpoint propio).
  @Get('proyectos/:proyectoId/tareas')
  listarPorProyecto(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('proyectoId') proyectoId: string,
    @Query() query: ListarTareasQueryDto,
  ) {
    return this.tareas.listarPorProyecto(proyectoId, usuario.id, query);
  }

  // RF-12
  @Post('proyectos/:proyectoId/tareas')
  crear(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('proyectoId') proyectoId: string,
    @Body() dto: CrearTareaDto,
  ) {
    return this.tareas.crear(proyectoId, usuario.id, dto);
  }

  // RF-13: bandeja de entrada del espacio.
  @Get('espacios/:espacioId/bandeja')
  listarBandeja(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('espacioId') espacioId: string,
    @Query() query: ListarTareasQueryDto,
  ) {
    return this.tareas.listarBandeja(espacioId, usuario.id, query);
  }

  // RF-12 (detalle con subtareasDetalle)
  @Get('tareas/:id')
  obtener(@CurrentUser() usuario: UsuarioAutenticado, @Param('id') id: string) {
    return this.tareas.obtener(id, usuario.id);
  }

  // RF-12: PATCH NO cambia estado (usar /estado) ni proyecto (usar /mover) ni padre (usar /subtareas).
  @Patch('tareas/:id')
  actualizar(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: ActualizarTareaDto,
  ) {
    return this.tareas.actualizar(id, usuario.id, dto);
  }

  // RF-12: borra la tarea y sus subtareas (cascada).
  @Delete('tareas/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@CurrentUser() usuario: UsuarioAutenticado, @Param('id') id: string) {
    await this.tareas.eliminar(id, usuario.id);
  }

  // RF-12: subtarea. Un solo nivel de anidación.
  @Post('tareas/:id/subtareas')
  crearSubtarea(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: CrearSubtareaDto,
  ) {
    return this.tareas.crearSubtarea(id, usuario.id, dto);
  }

  // RF-14: transiciones libres entre PENDIENTE | EN_CURSO | HECHA.
  @Patch('tareas/:id/estado')
  cambiarEstado(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: CambiarEstadoDto,
  ) {
    return this.tareas.cambiarEstado(id, usuario.id, dto);
  }

  // RF-13: mover a otro proyecto del mismo espacio. Las subtareas viajan con la tarea.
  @Post('tareas/:id/mover')
  @HttpCode(HttpStatus.OK)
  mover(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: MoverTareaDto,
  ) {
    return this.tareas.mover(id, usuario.id, dto);
  }
}
