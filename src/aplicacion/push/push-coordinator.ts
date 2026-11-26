import type { DetectorVencimientos } from './detector-vencimientos';
import type { PushDispatcher } from './push-dispatcher';

/** Un lote por invocación. Sin timers, hooks de arranque ni limpieza implícita. */
export class PushCoordinator {
  private activo = false;
  private barrido?: { ahora: Date; cursor?: string };

  constructor(private readonly detector: Pick<DetectorVencimientos, 'ejecutar'>,
    private readonly dispatcher: Pick<PushDispatcher, 'despachar'>,
    private readonly transitorio: (error: unknown) => boolean,
    private readonly clock: () => Date = () => new Date()) {}

  async ejecutar() {
    if (this.activo) return { omitido: true as const };
    this.activo = true;
    try {
      this.barrido ??= { ahora: new Date(this.clock().getTime()) };
      const pagina = this.barrido;
      let deteccion: 'OK' | 'ERROR' = 'ERROR';
      for (let intento = 0; intento < 3; intento++) {
        try {
          const resultado = await this.detector.ejecutar(new Date(pagina.ahora.getTime()), 100, pagina.cursor);
          // Solo confirmar cursor tras completar TODA la página. La repetición
          // conserva instante/cursor y la unicidad durable absorbe commits previos.
          this.barrido = resultado.siguiente === null ? undefined : { ahora: pagina.ahora, cursor: resultado.siguiente };
          deteccion = 'OK';
          break;
        } catch (error) {
          if (!this.transitorio(error)) break;
        }
      }
      // Un fallo de detección no impide procesar outbox ya confirmado.
      // No reejecutar el dispatcher ante un resultado incierto de I/O externo.
      try {
        return { omitido: false as const, deteccion, despacho: 'OK' as const, procesadas: await this.dispatcher.despachar(100) };
      } catch {
        return { omitido: false as const, deteccion, despacho: 'ERROR' as const, procesadas: 0 };
      }
    } finally {
      this.activo = false;
    }
  }
}
