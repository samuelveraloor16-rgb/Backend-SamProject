import type { TipoPush } from './push-outbox.repository';

export interface PushPayload {
  to: string;
  title: string;
  body: string;
  data: { tipo: TipoPush; tareaId: string; proyectoId: string; espacioId: string; comentarioId: string | null };
}
/** ACEPTADO significa ticket del proveedor, nunca entrega al dispositivo. */
export type PushResultado = 'ACEPTADO' | 'TRANSITORIO' | 'TOKEN_INVALIDO' | 'DEFINITIVO' | 'SIN_CONFIGURACION';
export interface PushProvider { enviar(payload: PushPayload): Promise<PushResultado> }
