import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import type { Response } from 'express';
import { ComentariosService } from '../../aplicacion/comentarios/comentarios.service';
import { PaginacionDto } from '../../aplicacion/comun/paginacion';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

class CrearComentarioDto { @IsString() texto!: string; }
class DirectorioQuery extends PaginacionDto {
  @IsOptional() @IsString() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value) @Length(1, 80) q?: string;
}
class AvisosQuery extends PaginacionDto {
  @IsOptional() @Transform(({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() leida?: boolean;
}
@Controller()
@UseGuards(JwtAuthGuard)
export class ComentariosController {
  constructor(private readonly comentarios: ComentariosService) {}
  @Post('tareas/:tareaId/comentarios')
  async crear(@Param('tareaId') id: string, @CurrentUser() u: UsuarioAutenticado, @Body() dto: CrearComentarioDto,
    @Headers('idempotency-key') clave: string | undefined, @Res({ passthrough: true }) res: Response) {
    const result = await this.comentarios.crear(id, u.id, dto.texto, clave);
    res.setHeader('Idempotency-Replayed', String(result.replay));
    return result.comentario;
  }
  @Get('tareas/:tareaId/comentarios')
  listar(@Param('tareaId') id: string, @CurrentUser() u: UsuarioAutenticado, @Query() q: PaginacionDto) { return this.comentarios.listar(id, u.id, q.page, q.pageSize); }
  @Get('tareas/:tareaId/miembros-mencionables')
  directorio(@Param('tareaId') id: string, @CurrentUser() u: UsuarioAutenticado, @Query() q: DirectorioQuery) { return this.comentarios.directorio(id, u.id, q.page, q.pageSize, q.q); }
  @Get('notificaciones')
  notificaciones(@CurrentUser() u: UsuarioAutenticado, @Query() q: AvisosQuery) { return this.comentarios.notificaciones(u.id, q.page, q.pageSize, q.leida); }
  @Patch('notificaciones/:id/leida')
  leer(@Param('id') id: string, @CurrentUser() u: UsuarioAutenticado, @Body() body: unknown) {
    if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0)) {
      throw new BadRequestException('No se admite contenido en el cuerpo');
    }
    return this.comentarios.leer(id, u.id);
  }
}
