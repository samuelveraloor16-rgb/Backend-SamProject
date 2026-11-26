import type { NuevoPush } from './push-outbox.repository';

export type ResultadoCorreo =
  | { estado: 'ACEPTADO' }
  | { estado: 'INCIERTO' }
  | { estado: 'RECHAZADO_PREVIO'; transitorio: boolean };
export interface CorreoEventosProvider {
  habilitado(): boolean;
  enviar(destino: string): Promise<ResultadoCorreo>;
}
/** La evidencia debe acreditar ESTA dirección actual, no otra dirección histórica. */
export interface EvidenciaCorreoVerificado {
  acredita(usuarioId: string, direccionActual: string): Promise<boolean>;
}
/** Adaptador explícito del modelo actual: no existe evidencia de verificación. */
export class SinEvidenciaCorreo implements EvidenciaCorreoVerificado {
  acredita(): Promise<boolean> { return Promise.resolve(false); }
}
export interface EventoCorreo extends NuevoPush {
  /** Instante del evento original, NO instante de escaneo/replay. */
  ocurridoEn: Date;
}
export interface ReservaCorreo { digest: string; generacion: string; intentos: number; usuarioId: string }
export interface CorreoDispatchRepository {
  /** Recupera fases de I/O vencidas como INCIERTO; jamás vuelve a PENDIENTE. */
  recuperar(): Promise<void>;
  candidatos(): Promise<string[]>;
  /** Con locks y reloj BD, revalida toda elegibilidad y dirección ACTUAL.
   * Sin evidencia o política de vigencia devuelve null sin consumir presupuesto. */
  preparar(digest: string, evidencia: EvidenciaCorreoVerificado): Promise<(ReservaCorreo & { direccion: string }) | null>;
  finalizar(reserva: ReservaCorreo, resultado: ResultadoCorreo): Promise<void>;
}
