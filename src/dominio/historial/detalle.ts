/** Allowlist §16.6 de escritores tipados: nunca sanea/acredita JSON legacy. */
export const CAMPOS_EDITABLES = [
  'nombre', 'descripcion', 'fechaInicio', 'fechaFin', 'miembros', 'titulo',
  'prioridad', 'fechaLimite', 'responsableId', 'etiquetas',
] as const;
export type CampoEditable = typeof CAMPOS_EDITABLES[number];

function objeto(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function claves(value: Record<string, unknown>, esperadas: string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === esperadas.length && keys.every(key => typeof key === 'string'
    && esperadas.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined);
}

/** Solo formas que no requieren resolver IDs; movimiento y adjuntos fallan cerrado. */
export function esDetalleGeneral(accion: unknown, detalle: unknown): boolean {
  if (!objeto(detalle)) return false;
  switch (accion) {
    case 'CREADO': case 'ELIMINADO': case 'ARCHIVADO': case 'DESARCHIVADO':
      return claves(detalle, []);
    case 'EDITADO':
      return claves(detalle, ['changedFields']) && Array.isArray(detalle.changedFields)
        && detalle.changedFields.length > 0 && new Set(detalle.changedFields).size === detalle.changedFields.length
        && detalle.changedFields.every(f => typeof f === 'string' && (CAMPOS_EDITABLES as readonly string[]).includes(f));
    case 'ESTADO_CAMBIADO': {
      const estados: readonly unknown[] = ['PENDIENTE', 'EN_CURSO', 'HECHA'];
      return claves(detalle, ['estadoAnterior', 'estadoNuevo'])
        && estados.includes(detalle.estadoAnterior) && estados.includes(detalle.estadoNuevo)
        && detalle.estadoAnterior !== detalle.estadoNuevo;
    }
    default: return false;
  }
}

/** Solo nombres, nunca valores. El llamante futuro debe leer bajo lock. */
export function camposModificados(
  anterior: Partial<Record<CampoEditable, unknown>>,
  nuevo: Partial<Record<CampoEditable, unknown>>,
): CampoEditable[] {
  const iguales = (a: unknown, b: unknown): boolean => {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) {
      if (!a.every(v => typeof v === 'string') || !b.every(v => typeof v === 'string')) return false;
      const x = new Set(a); const y = new Set(b);
      return x.size === y.size && [...x].every(v => y.has(v));
    }
    return a === b;
  };
  return CAMPOS_EDITABLES.filter(c => Object.prototype.hasOwnProperty.call(nuevo, c)
    && nuevo[c] !== undefined && !iguales(anterior[c], nuevo[c]));
}
