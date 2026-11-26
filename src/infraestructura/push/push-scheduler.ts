import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PushCoordinator } from '../../aplicacion/push/push-coordinator';

/** No ejecuta al arrancar. La guardia del coordinador cubre también llamadas manuales. */
@Injectable()
export class PushScheduler {
  private readonly logger = new Logger(PushScheduler.name);

  constructor(private readonly config: ConfigService, private readonly coordinator: PushCoordinator) {}

  @Interval('rf20-push', 60_000)
  async tick(): Promise<void> {
    // Fail closed: no boolean coercion ni activación por credenciales presentes.
    if (this.config.get<string>('PUSH_SCHEDULER_ENABLED') !== 'true') return;
    try {
      const result = await this.coordinator.ejecutar();
      if (!result.omitido && (result.deteccion === 'ERROR' || result.despacho === 'ERROR')) {
        this.logger.warn('RF20: lote incompleto; se conservaron los controles de reintento');
      }
    } catch {
      // Nunca serializar errores externos: pueden incluir tokens, SQL o credenciales.
      this.logger.warn('RF20: fallo de programación periódica');
    }
  }
}
