import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { extraerMenciones, FormatoComentarioInvalido } from '../../dominio/comentarios/menciones';
import { COMENTARIOS_REPOSITORY, type ComentariosRepository } from '../../dominio/puertos/comentarios.repository';

@Injectable()
export class ComentariosService {
  constructor(@Inject(COMENTARIOS_REPOSITORY) private readonly repo: ComentariosRepository) {}

  crear(tareaId: string, usuarioId: string, texto: string, clave: string | undefined) {
    if (!clave || !/^[A-Za-z0-9_-]{1,128}$/.test(clave)) throw new BadRequestException('Idempotency-Key inválida');
    let menciones: string[];
    try { menciones = extraerMenciones(texto); }
    catch (error) {
      if (error instanceof FormatoComentarioInvalido) throw new BadRequestException(error.message);
      throw error;
    }
    return this.repo.crear(tareaId, usuarioId, texto, clave, menciones);
  }
  listar(tareaId: string, usuarioId: string, page: number, pageSize: number) { return this.repo.listar(tareaId, usuarioId, page, pageSize); }
  directorio(tareaId: string, usuarioId: string, page: number, pageSize: number, q?: string) { return this.repo.directorio(tareaId, usuarioId, page, pageSize, q); }
  notificaciones(usuarioId: string, page: number, pageSize: number, leida?: boolean) { return this.repo.notificaciones(usuarioId, page, pageSize, leida); }
  leer(id: string, usuarioId: string) { return this.repo.leer(id, usuarioId); }
}
