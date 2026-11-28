export const HISTORIAL_REPOSITORY = Symbol('HISTORIAL_REPOSITORY');
export type RecursoHistorial = 'PROYECTO' | 'TAREA';
export interface HistorialRepository {
  listar(tipo: RecursoHistorial, id: string, usuarioId: string, query: Record<string, unknown>, body?: unknown): Promise<unknown>;
}
