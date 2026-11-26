export const DISPOSITIVO_REPOSITORY = Symbol('DISPOSITIVO_REPOSITORY');
export type PlataformaPush = 'ANDROID' | 'IOS';
/** Proyección pública: no contiene token ni material de transferencia. */
export interface DispositivoPublico {
  id: string;
  plataforma: PlataformaPush;
  creadoEn: Date;
  actualizadoEn: Date;
  ultimoEnvioEn: Date | null;
}
export interface DispositivoRepository {
  registrar(usuarioId: string, token: string, plataforma: PlataformaPush): Promise<{ dispositivo: DispositivoPublico; creado: boolean }>;
  listar(usuarioId: string, page: number, pageSize: number): Promise<{ datos: DispositivoPublico[]; total: number }>;
  revocar(usuarioId: string, id: string): Promise<boolean>;
  emitirCodigo(usuarioId: string, id: string): Promise<{ codigo: string; expiraEn: Date } | null>;
  transferir(usuarioId: string, codigo: string, token: string): Promise<DispositivoPublico | null>;
}
