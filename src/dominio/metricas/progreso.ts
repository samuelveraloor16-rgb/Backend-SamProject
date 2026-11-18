// RF-11 / RF-15 — cálculos puros de dominio, fuente única de verdad para
// panel móvil, asistente y AdminWeb. Sin dependencias de infraestructura.

export interface TareaContable {
  estado: 'PENDIENTE' | 'EN_CURSO' | 'HECHA';
  fechaLimite: Date | null;
}

export interface ResumenProgreso {
  total: number;
  hechas: number;
  pendientes: number;
  enCurso: number;
  vencidas: number;
  progreso: number; // 0-100, 1 decimal
}

/** Inicio del día (hora local del servidor) para la regla «vencida» de RF-15. */
export function inicioDelDia(referencia: Date = new Date()): Date {
  const d = new Date(referencia);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** RF-15: vencida = fechaLimite pasada (antes del inicio de hoy) y estado != HECHA. Nunca es un estado. */
export function esVencida(
  t: { fechaLimite: Date | null; estado: string },
  referencia: Date = new Date(),
): boolean {
  if (!t.fechaLimite) return false;
  return t.fechaLimite.getTime() < inicioDelDia(referencia).getTime() && t.estado !== 'HECHA';
}

/**
 * RF-11: recibe SOLO las tareas contables (tareas sin subtareas + subtareas;
 * la tarea padre con subtareas NO se incluye). Progreso con 1 decimal; 0 si total = 0.
 */
export function calcularProgreso(
  contables: TareaContable[],
  referencia: Date = new Date(),
): ResumenProgreso {
  const total = contables.length;
  let hechas = 0;
  let pendientes = 0;
  let enCurso = 0;
  let vencidas = 0;
  for (const t of contables) {
    if (t.estado === 'HECHA') hechas += 1;
    else if (t.estado === 'EN_CURSO') enCurso += 1;
    else pendientes += 1;
    if (esVencida(t, referencia)) vencidas += 1;
  }
  const progreso = total === 0 ? 0 : Math.round((hechas / total) * 1000) / 10;
  return { total, hechas, pendientes, enCurso, vencidas, progreso };
}
