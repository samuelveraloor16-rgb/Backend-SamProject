import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PaginacionDto } from '../../aplicacion/comun/paginacion';
import { DispositivosService } from '../../aplicacion/dispositivos/dispositivos.service';
import { RegistrarDispositivoDto, TransferirDispositivoDto } from '../../aplicacion/dtos/dispositivo-dtos';
import { CurrentUser, type UsuarioAutenticado } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('dispositivos')
@UseGuards(JwtAuthGuard)
export class DispositivosController {
  constructor(private readonly dispositivos: DispositivosService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async registrar(@CurrentUser() u: UsuarioAutenticado, @Body() dto: RegistrarDispositivoDto, @Res({ passthrough: true }) res: Response) {
    const { dispositivo, creado } = await this.dispositivos.registrar(u.id, dto.token, dto.plataforma);
    res.status(creado ? 201 : 200);
    return dispositivo;
  }

  @Get()
  listar(@CurrentUser() u: UsuarioAutenticado, @Query() q: PaginacionDto) {
    return this.dispositivos.listar(u.id, q.page, q.pageSize);
  }

  @Delete(':id')
  @HttpCode(204)
  revocar(@CurrentUser() u: UsuarioAutenticado, @Param('id') id: string) {
    return this.dispositivos.revocar(u.id, id);
  }

  @Post(':id/codigo-transferencia')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  emitirCodigo(@CurrentUser() u: UsuarioAutenticado, @Param('id') id: string, @Body() body: unknown) {
    if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0)) {
      throw new BadRequestException('No se admite contenido en el cuerpo');
    }
    return this.dispositivos.emitirCodigo(u.id, id);
  }

  @Post('transferencia')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  transferir(@CurrentUser() u: UsuarioAutenticado, @Body() dto: TransferirDispositivoDto) {
    return this.dispositivos.transferir(u.id, dto.codigo, dto.token);
  }
}
