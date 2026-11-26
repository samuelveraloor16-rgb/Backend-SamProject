import type { PushOutboxRepository } from '../../dominio/puertos/push-outbox.repository';
import type { PushDispatchRepository } from '../../dominio/puertos/push-dispatch.repository';
import type { PushProvider } from '../../dominio/puertos/push-provider';

export class PushDispatcher {
  constructor(private readonly outbox: PushOutboxRepository, private readonly store: PushDispatchRepository,
    private readonly provider: PushProvider, private readonly warn: (message: string) => void = () => {},
    private readonly clock: () => Date = () => new Date()) {}

  /** Invocación explícita; jamás llamada dentro de una transacción de negocio. */
  async despachar(limite = 100): Promise<number> {
    const filas = await this.outbox.pendientes(this.clock(), limite);
    let procesadas = 0;
    for (const fila of filas) {
      try {
        if (!await this.store.reclamar(fila, this.clock())) continue;
        const intento = fila.intentos + 1;
        let transient = false, permanent = false, accepted = false;
        for (const vinculo of await this.store.dispositivos(fila.usuarioId)) {
          if (await this.store.aceptado(fila.id, vinculo)) { accepted = true; continue; }
          if (await this.store.rechazado(fila.id, vinculo)) { permanent = true; continue; }
          const payload = await this.store.revalidar(fila, vinculo);
          if (payload === 'LIMITADO') { transient = true; continue; }
          if (!payload) continue;
          const result = await this.provider.enviar(payload);
          if (result === 'ACEPTADO') {
            await this.store.registrarAceptado(fila.id, vinculo);
            accepted = true;
          } else if (result === 'TOKEN_INVALIDO') await this.store.revocar(vinculo);
          else if (result === 'TRANSITORIO' || result === 'SIN_CONFIGURACION') transient = true;
          else { await this.store.registrarRechazado(fila.id, vinculo); permanent = true; }
        }
        const ahora = this.clock();
        const estado = transient ? (intento >= 5 ? 'FALLIDO' : 'PENDIENTE') : permanent ? 'FALLIDO' : accepted ? 'ENVIADO' : 'DESCARTADO';
        await this.store.finalizar(fila.id, intento, { estado, intentos: intento,
          proximoIntentoEn: new Date(ahora.getTime() + Math.min(7200000, 60000 * 2 ** (intento - 1))),
          ...(estado === 'ENVIADO' ? { enviadoEn: ahora } : {}),
        });
        if (transient || permanent) this.warn('Push: proveedor no disponible o rechazo de envío');
        procesadas++;
      } catch {
        // Claim conserva lease y consume intento ante crash/error de almacenamiento.
        // Nunca imprimir el error del driver/proveedor: puede contener secretos.
        this.warn('Push: no se pudo completar el despacho');
      }
    }
    return procesadas;
  }
}
