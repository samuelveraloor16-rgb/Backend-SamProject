import type { VencimientosRepository } from '../../dominio/puertos/vencimientos.repository';

/** Invocación explícita: no inicia timers, no despacha ni resuelve proveedores. */
export class DetectorVencimientos {
  constructor(private readonly repository: VencimientosRepository) {}

  async ejecutar(ahora: Date, limite = 100, despuesDe?: string) {
    if (!Number.isFinite(ahora.getTime())) throw new RangeError('Instante inválido');
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw new RangeError('Límite inválido');
    const filas = await this.repository.candidatos(ahora, despuesDe, limite);
    let encolados = 0;
    for (const fila of filas) if (await this.repository.encolarVigente(fila, ahora)) encolados++;
    // Avanza por filas examinadas, no por inserciones: duplicados no causan inanición.
    return { examinados: filas.length, encolados, siguiente: filas.length === limite ? filas.at(-1)!.id : null };
  }
}
