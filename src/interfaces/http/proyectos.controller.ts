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
import { ProyectosService } from '../../aplicacion/proyectos/proyectos.service';
import {
  ArchivarProyectoDto,
  ActualizarProyectoDto,
  CrearProyectoDto,
  ListarProyectosQueryDto,
} from '../../aplicacion/dtos/proyecto-dtos';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProyectosController {
  constructor(private readonly proyectos: ProyectosService) {}

  // RF-09: listado de proyectos del espacio (la Bandeja NO aparece aquí).
  @Get('espacios/:espacioId/proyectos')
  listar(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('espacioId') espacioId: string,
    @Query() query: ListarProyectosQueryDto,
  ) {
    return this.proyectos.listar(espacioId, usuario.id, query);
  }

  // RF-09/RF-10
  @Post('espacios/:espacioId/proyectos')
  crear(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('espacioId') espacioId: string,
    @Body() dto: CrearProyectoDto,
  ) {
    return this.proyectos.crear(espacioId, usuario.id, dto);
  }

  // RF-09/RF-10
  @Get('proyectos/:id')
  obtener(@CurrentUser() usuario: UsuarioAutenticado, @Param('id') id: string) {
    return this.proyectos.obtener(id, usuario.id);
  }

  // RF-09: no editable si está archivado (salvo desarchivar vía /archivar).
  @Patch('proyectos/:id')
  actualizar(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: ActualizarProyectoDto,
  ) {
    return this.proyectos.actualizar(id, usuario.id, dto);
  }

  // RF-09: DELETE solo ADMINISTRADOR. Borrado físico en cascada. Bandeja → 400.
  @Delete('proyectos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@CurrentUser() usuario: UsuarioAutenticado, @Param('id') id: string) {
    await this.proyectos.eliminar(id, usuario.id);
  }

  // RF-09: archivar/desarchivar. Miembro del espacio. Bandeja → 400.
  @Post('proyectos/:id/archivar')
  @HttpCode(HttpStatus.OK)
  archivar(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: ArchivarProyectoDto,
  ) {
    return this.proyectos.archivar(id, usuario.id, dto);
  }

  // RF-11: fuente única de verdad del progreso.
  @Get('proyectos/:id/progreso')
  progreso(@CurrentUser() usuario: UsuarioAutenticado, @Param('id') id: string) {
    return this.proyectos.progreso(id, usuario.id);
  }
}
