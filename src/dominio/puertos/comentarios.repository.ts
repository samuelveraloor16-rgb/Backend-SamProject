export const COMENTARIOS_REPOSITORY = Symbol('COMENTARIOS_REPOSITORY');

export interface ComentariosRepository {
  crear(tareaId: string, usuarioId: string, texto: string, clave: string, menciones: string[]): Promise<{ comentario: unknown; replay: boolean }>;
  listar(tareaId: string, usuarioId: string, page: number, pageSize: number): Promise<unknown>;
  directorio(tareaId: string, usuarioId: string, page: number, pageSize: number, q?: string): Promise<unknown>;
  notificaciones(usuarioId: string, page: number, pageSize: number, leida?: boolean): Promise<unknown>;
  leer(id: string, usuarioId: string): Promise<unknown>;
}
