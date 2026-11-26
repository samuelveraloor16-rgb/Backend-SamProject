export const PUSH_OUTBOX_REPOSITORY = Symbol('PUSH_OUTBOX_REPOSITORY');
export type TipoPush = 'TAREA_ASIGNADA' | 'TAREA_POR_VENCER' | 'TAREA_VENCIDA' | 'COMENTARIO' | 'MENCION';
export interface NuevoPush {
  claveUnica: string;
  usuarioId: string;
  tipo: TipoPush;
  tareaId: string;
  comentarioId?: string | null;
}
/** Solo almacenamiento; la política de envío/reintentos pertenece al futuro procesador. */
export interface PushOutboxRepository {
  encolar(evento: NuevoPush): Promise<boolean>;
  pendientes(hasta: Date, limite: number): Promise<PushAlmacenado[]>;
  actualizar(id: string, intentosEsperados: number, cambio: CambioPush): Promise<boolean>;
}
export interface PushAlmacenado extends NuevoPush {
  id: string;
  intentos: number;
  proximoIntentoEn: Date;
}
export interface CambioPush {
  estado: 'PENDIENTE' | 'ENVIADO' | 'FALLIDO' | 'DESCARTADO';
  intentos: number;
  proximoIntentoEn?: Date;
  enviadoEn?: Date | null;
}
