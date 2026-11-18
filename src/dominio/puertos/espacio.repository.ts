// Puerto (Clean Architecture): acceso del dominio al mundo exterior para espacios,
// membresías e invitaciones. Los adaptadores concretos viven en infraestructura/.

export type RolEspacio = 'ADMINISTRADOR' | 'MIEMBRO';

export interface EspacioEntity {
  id: string;
  nombre: string;
  esPersonal: boolean;
  asistenteActivo: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface MembresiaEntity {
  id: string;
  usuarioId: string;
  espacioId: string;
  rol: RolEspacio;
  creadoEn: Date;
}

/** Espacio visto por un usuario concreto: rol propio y total de miembros. */
export interface EspacioConMembresia {
  espacio: EspacioEntity;
  miRol: RolEspacio;
  totalMiembros: number;
}

export interface InvitacionEntity {
  id: string;
  tokenHash: string;
  email: string;
  rol: RolEspacio;
  espacioId: string;
  invitadoPorId: string | null;
  expiraEn: Date;
  aceptadaEn: Date | null;
  creadoEn: Date;
}

export interface DatosCrearInvitacion {
  tokenHash: string;
  email: string;
  rol: RolEspacio;
  espacioId: string;
  invitadoPorId: string | null;
  expiraEn: Date;
}

export interface EspacioRepository {
  /** RF-05: espacios del usuario (personales primero, luego por creadoEn). Sin paginación: el volumen por usuario es pequeño. */
  listarDeUsuario(usuarioId: string): Promise<EspacioConMembresia[]>;
  buscarPorId(id: string): Promise<EspacioEntity | null>;
  obtenerMembresia(espacioId: string, usuarioId: string): Promise<MembresiaEntity | null>;
  /** RF-06: crea espacio de equipo; el creador queda ADMINISTRADOR y se crea su Bandeja de entrada (transacción). */
  crearConAdmin(datos: { nombre: string; creadorId: string }): Promise<EspacioEntity>;
  actualizar(
    id: string,
    datos: { nombre?: string; asistenteActivo?: boolean },
  ): Promise<EspacioEntity>;
  contarMiembros(espacioId: string): Promise<number>;
  contarAdministradores(espacioId: string): Promise<number>;
  /** Busca un usuario por correo (para detectar "ya es miembro" al invitar). */
  buscarUsuarioPorEmail(email: string): Promise<{ id: string; email: string } | null>;

  crearInvitacion(datos: DatosCrearInvitacion): Promise<InvitacionEntity>;
  buscarInvitacionPorTokenHash(tokenHash: string): Promise<InvitacionEntity | null>;
  /** Marca la invitación como aceptada (un solo uso) y crea la membresía. Devuelve la membresía creada. */
  aceptarInvitacion(datos: {
    invitacionId: string;
    usuarioId: string;
    espacioId: string;
    rol: RolEspacio;
  }): Promise<MembresiaEntity>;

  actualizarRolMembresia(
    espacioId: string,
    usuarioId: string,
    rol: RolEspacio,
  ): Promise<MembresiaEntity | null>;
  eliminarMembresia(espacioId: string, usuarioId: string): Promise<boolean>;
}

export const ESPACIO_REPOSITORY = Symbol('ESPACIO_REPOSITORY');
