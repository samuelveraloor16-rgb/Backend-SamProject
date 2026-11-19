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
import { EspaciosService } from '../../aplicacion/espacios/espacios.service';
import { PaginacionDto } from '../../aplicacion/comun/paginacion';
import {
  ActualizarEspacioDto,
  ActualizarRolDto,
  CrearEspacioDto,
  CrearInvitacionDto,
} from '../../aplicacion/dtos/espacio-dtos';
import { CalendarioQueryDto } from '../../aplicacion/dtos/tarea-dtos';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';

@Controller('espacios')
@UseGuards(JwtAuthGuard)
export class EspaciosController {
  constructor(private readonly espacios: EspaciosService) {}

  // RF-05/RF-06
  @Get()
  listar(@CurrentUser() usuario: UsuarioAutenticado, @Query() query: PaginacionDto) {
    return this.espacios.listar(usuario.id, query);
  }

  // RF-06
  @Post()
  crear(@CurrentUser() usuario: UsuarioAutenticado, @Body() dto: CrearEspacioDto) {
    return this.espacios.crear(usuario.id, dto);
  }

  // RF-18: calendario del espacio (RF-18). Miembro del espacio; ?desde & ?hasta en YYYY-MM-DD.
  @Get(':espacioId/calendario')
  calendario(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('espacioId') espacioId: string,
    @Query() query: CalendarioQueryDto,
  ) {
    return this.espacios.calendario(espacioId, usuario.id, query);
  }

  @Get(':id')
  obtener(@CurrentUser() usuario: UsuarioAutenticado, @Param('id') id: string) {
    return this.espacios.obtener(id, usuario.id);
  }

  // RF-08: solo ADMINISTRADOR (se valida en el servicio)
  @Patch(':id')
  actualizar(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: ActualizarEspacioDto,
  ) {
    return this.espacios.actualizar(id, usuario.id, dto);
  }

  // RF-06: invitar por correo. Solo ADMINISTRADOR.
  @Post(':id/invitaciones')
  invitar(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: CrearInvitacionDto,
  ) {
    return this.espacios.invitar(id, usuario.id, dto);
  }

  // RF-07: salir del espacio. Declarada ANTES de ':usuarioId' para que "me" no se capture como id.
  @Delete(':id/miembros/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async salir(@CurrentUser() usuario: UsuarioAutenticado, @Param('id') id: string) {
    await this.espacios.salir(id, usuario.id);
  }

  // RF-07: cambiar rol. Solo ADMINISTRADOR.
  @Patch(':id/miembros/:usuarioId')
  cambiarRol(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Param('usuarioId') objetivoUsuarioId: string,
    @Body() dto: ActualizarRolDto,
  ) {
    return this.espacios.cambiarRol(id, usuario.id, objetivoUsuarioId, dto);
  }

  // RF-07: quitar miembro. Solo ADMINISTRADOR. 204 sin body.
  @Delete(':id/miembros/:usuarioId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async quitarMiembro(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Param('usuarioId') objetivoUsuarioId: string,
  ) {
    await this.espacios.quitarMiembro(id, usuario.id, objetivoUsuarioId);
  }
}

// POST /invitaciones/:token/aceptar — RF-06. El token es el del enlace del correo.
@Controller('invitaciones')
@UseGuards(JwtAuthGuard)
export class InvitacionesController {
  constructor(private readonly espacios: EspaciosService) {}

  @Post(':token/aceptar')
  @HttpCode(HttpStatus.OK)
  aceptar(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('token') token: string,
  ) {
    return this.espacios.aceptarInvitacion(token, usuario.id);
  }
}
