import { Inject, Injectable } from '@nestjs/common';
import { CambioPreferencia, matrizEfectiva, PREFERENCIAS_REPOSITORY, PreferenciasRepository } from '../../dominio/puertos/preferencias.repository';
@Injectable()
export class PreferenciasService {
  constructor(@Inject(PREFERENCIAS_REPOSITORY) private readonly repo: PreferenciasRepository) {}
  async obtener(usuarioId: string) { return matrizEfectiva(await this.repo.listar(usuarioId)); }
  async actualizar(usuarioId: string, cambios: CambioPreferencia[]) {
    return matrizEfectiva(await this.repo.actualizar(usuarioId, cambios));
  }
}
