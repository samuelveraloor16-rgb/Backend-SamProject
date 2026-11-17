// Puerto (Clean Architecture): lo que el dominio necesita del mundo exterior.
// Los adaptadores concretos viven en infraestructura/.

export interface UsuarioEntity {
  id: string;
  email: string;
  nombre: string;
  fotoUrl: string | null;
  passwordHash: string;
  tokenVersion: number;
  resetTokenHash: string | null;
  resetTokenExpires: Date | null;
  creadoEn: Date;
  actualizadoEn: Date;
}

/** Datos necesarios para crear la cuenta completa en una transacción. */
export interface DatosRegistroConEspacio {
  nombre: string;
  email: string;
  passwordHash: string;
}

export interface DatosActualizarPerfil {
  nombre?: string;
  fotoUrl?: string | null;
}

export interface UsuarioRepository {
  buscarPorEmail(email: string): Promise<UsuarioEntity | null>;
  buscarPorId(id: string): Promise<UsuarioEntity | null>;
  /**
   * RF-01/RF-05/RF-13: crea Usuario + EspacioDeTrabajo personal
   * ("Espacio de <nombre>") + Membresía ADMINISTRADOR + Proyecto "Bandeja de entrada"
   * (esBandejaDeEntrada = true) en UNA sola transacción.
   */
  crearConEspacioPersonal(datos: DatosRegistroConEspacio): Promise<UsuarioEntity>;
  actualizarPerfil(id: string, datos: DatosActualizarPerfil): Promise<UsuarioEntity>;
  /** Actualiza hash de contraseña y limpia el token de reset. Incrementa tokenVersion (invalida sesiones). */
  restablecerPassword(id: string, passwordHash: string): Promise<void>;
  actualizarPasswordDesdePerfil(id: string, passwordHash: string): Promise<void>;
  incrementarTokenVersion(id: string): Promise<void>;
  guardarResetToken(id: string, tokenHash: string, expira: Date): Promise<void>;
  buscarPorResetTokenHash(tokenHash: string): Promise<UsuarioEntity | null>;
}

export const USUARIO_REPOSITORY = Symbol('USUARIO_REPOSITORY');
