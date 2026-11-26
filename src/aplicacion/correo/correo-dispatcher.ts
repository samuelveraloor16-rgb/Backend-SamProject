import type { CorreoDispatchRepository, CorreoEventosProvider, EvidenciaCorreoVerificado, ResultadoCorreo } from '../../dominio/puertos/correo-eventos';

/** No se registra en DI hasta contar con adaptador de elegibilidad y verificación.
 * SMTP se invoca DESPUÉS de confirmar preparar(), nunca en su transacción. */
export class CorreoDispatcher {
  private ocupado = false;
  constructor(private readonly repository: CorreoDispatchRepository,
    private readonly proveedor: CorreoEventosProvider,
    private readonly evidencia: EvidenciaCorreoVerificado) {}

  async ejecutar(): Promise<void> {
    if (this.ocupado || !this.proveedor.habilitado()) return;
    this.ocupado = true;
    try {
      await this.repository.recuperar();
      for (const digest of await this.repository.candidatos()) {
        if (!this.proveedor.habilitado()) break;
        const reserva = await this.repository.preparar(digest, this.evidencia);
        if (!reserva) continue;
        let resultado: ResultadoCorreo;
        try { resultado = await this.proveedor.enviar(reserva.direccion); }
        catch { resultado = { estado: 'INCIERTO' }; }
        // No capturar fallo de persistencia como rechazo SMTP: se conserva fase
        // durable EN_IO y recuperación futura la vuelve INCIERTO, no reenviable.
        await this.repository.finalizar(reserva, resultado);
      }
    } finally { this.ocupado = false; }
  }
}

export function siguienteCorreo(intentos: number, resultado: ResultadoCorreo): {
  estado: 'ACEPTADO' | 'INCIERTO' | 'FALLIDO' | 'PENDIENTE'; esperaMs: number;
} {
  if (!Number.isInteger(intentos) || intentos < 1 || intentos > 6) throw new RangeError('Presupuesto inválido');
  if (resultado.estado !== 'RECHAZADO_PREVIO') return { estado: resultado.estado, esperaMs: 0 };
  if (!resultado.transitorio || intentos === 6) return { estado: 'FALLIDO', esperaMs: 0 };
  return { estado: 'PENDIENTE', esperaMs: Math.min(7200000, 60000 * 2 ** (intentos - 1)) };
}
