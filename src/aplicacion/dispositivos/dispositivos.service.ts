import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DISPOSITIVO_REPOSITORY, type DispositivoRepository, type PlataformaPush } from '../../dominio/puertos/dispositivo.repository';
import { envelope } from '../comun/paginacion';

@Injectable()
export class DispositivosService {
  constructor(@Inject(DISPOSITIVO_REPOSITORY) private readonly repo: DispositivoRepository) {}

  registrar(usuarioId: string, token: string, plataforma: PlataformaPush) {
    return this.repo.registrar(usuarioId, token, plataforma);
  }

  async listar(usuarioId: string, page: number, pageSize: number) {
    const { datos, total } = await this.repo.listar(usuarioId, page, pageSize);
    return envelope(datos, total, page, pageSize);
  }

  async revocar(usuarioId: string, id: string) {
    if (!await this.repo.revocar(usuarioId, id)) throw new NotFoundException('Dispositivo no encontrado');
  }

  async emitirCodigo(usuarioId: string, id: string) {
    const resultado = await this.repo.emitirCodigo(usuarioId, id);
    if (!resultado) throw new NotFoundException('Dispositivo no encontrado');
    return resultado;
  }

  async transferir(usuarioId: string, codigo: string, token: string) {
    const resultado = /^[A-Z2-9]{8}$/.test(codigo) ? await this.repo.transferir(usuarioId, codigo, token) : null;
    if (!resultado) throw new BadRequestException('La transferencia no es válida o ha caducado');
    return resultado;
  }
}
