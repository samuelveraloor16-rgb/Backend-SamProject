export const TIPOS_PREFERENCIA = ['TAREA_ASIGNADA', 'TAREA_POR_VENCER', 'TAREA_VENCIDA', 'COMENTARIO', 'MENCION'] as const;
export type TipoPreferencia = typeof TIPOS_PREFERENCIA[number];
export interface PreferenciaNotificacion {
  tipo: TipoPreferencia;
  inApp: boolean;
  correo: boolean;
  push: boolean;
}
export type CambioPreferencia = Pick<PreferenciaNotificacion, 'tipo'> & Partial<Omit<PreferenciaNotificacion, 'tipo'>>;
export const PREFERENCIAS_REPOSITORY = Symbol('PREFERENCIAS_REPOSITORY');
export interface PreferenciasRepository {
  listar(usuarioId: string): Promise<PreferenciaNotificacion[]>;
  actualizar(usuarioId: string, cambios: CambioPreferencia[]): Promise<PreferenciaNotificacion[]>;
}
export function matrizEfectiva(filas: PreferenciaNotificacion[]) {
  return { preferencias: TIPOS_PREFERENCIA.map(tipo => ({
    tipo, inApp: tipo === 'MENCION', correo: false, push: true,
    ...filas.find(f => f.tipo === tipo),
  })) };
}
