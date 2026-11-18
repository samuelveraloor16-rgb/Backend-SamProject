import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EtiquetasService } from '../../aplicacion/etiquetas/etiquetas.service';
import { CrearEtiquetaDto } from '../../aplicacion/dtos/tarea-dtos';
import { PaginacionDto } from '../../aplicacion/comun/paginacion';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';

@Controller('espacios/:espacioId/etiquetas')
@UseGuards(JwtAuthGuard)
export class EtiquetasController {
  constructor(private readonly etiquetas: EtiquetasService) {}

  // RF-12
  @Get()
  listar(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('espacioId') espacioId: string,
    @Query() query: PaginacionDto,
  ) {
    return this.etiquetas.listar(espacioId, usuario.id, query);
  }

  // RF-12: nombre único por espacio (case-insensitive) → 409.
  @Post()
  crear(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Param('espacioId') espacioId: string,
    @Body() dto: CrearEtiquetaDto,
  ) {
    return this.etiquetas.crear(espacioId, usuario.id, dto);
  }
}
