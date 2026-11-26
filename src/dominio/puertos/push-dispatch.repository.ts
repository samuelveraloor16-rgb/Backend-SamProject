import type { PushAlmacenado, CambioPush } from './push-outbox.repository';
import type { PushPayload } from './push-provider';

export interface VinculoPush { id: string; usuarioId: string; tokenPush: string; tokenVersionVinculado: number; actualizadoEn: Date }
export interface PushDispatchRepository {
  /** Claim CAS, lease 2 min, máximo 5 intentos. Una sola fila en vuelo por usuario. */
  reclamar(fila: PushAlmacenado, ahora: Date): Promise<boolean>;
  dispositivos(usuarioId: string): Promise<VinculoPush[]>;
  /** Reconsulta propiedad, generación, tokenVersion y acceso RF19 inmediatamente antes del I/O. */
  revalidar(fila: PushAlmacenado, vinculo: VinculoPush): Promise<PushPayload | null | 'LIMITADO'>;
  aceptado(outboxId: string, vinculo: VinculoPush): Promise<boolean>;
  rechazado(outboxId: string, vinculo: VinculoPush): Promise<boolean>;
  registrarAceptado(outboxId: string, vinculo: VinculoPush): Promise<void>;
  registrarRechazado(outboxId: string, vinculo: VinculoPush): Promise<void>;
  revocar(vinculo: VinculoPush): Promise<void>;
  finalizar(id: string, intento: number, cambio: CambioPush): Promise<boolean>;
}
