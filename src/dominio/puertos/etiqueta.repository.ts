// Puerto (Clean Architecture): etiquetas por espacio.

export interface EtiquetaEntity {
  id: string;
  nombre: string;
  color: string | null;
  espacioId: string;
  creadoEn: Date;
}

export interface EtiquetaRepository {
  listarPorEspacio(espacioId: string): Promise<EtiquetaEntity[]>;
  crear(datos: { nombre: string; color: string | null; espacioId: string }): Promise<EtiquetaEntity>;
  buscarPorIdsEnEspacio(espacioId: string, ids: string[]): Promise<EtiquetaEntity[]>;
  /** Comparación case-insensitive para el unique por espacio de RF-12. */
  existeNombreEnEspacio(espacioId: string, nombre: string): Promise<boolean>;
}

export const ETIQUETA_REPOSITORY = Symbol('ETIQUETA_REPOSITORY');
