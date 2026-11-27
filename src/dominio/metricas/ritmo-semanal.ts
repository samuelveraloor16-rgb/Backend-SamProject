const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

export function lunesUtc(instante: Date): Date {
  const inicio = new Date(instante);
  inicio.setUTCHours(0, 0, 0, 0);
  inicio.setUTCDate(inicio.getUTCDate() - (inicio.getUTCDay() + 6) % 7);
  return inicio;
}

export function inicioVentanaSemanal(corte: Date): Date {
  return new Date(lunesUtc(corte).getTime() - 4 * SEMANA_MS);
}

export interface GrupoFinalizaciones {
  inicio: Date;
  finalizaciones: number;
}

export interface HistorialSemanal {
  desde: Date | null;
  /** Requiere evidencia externa verificable; la fecha de migración NO basta. */
  coberturaAcreditada: boolean;
  grupos: GrupoFinalizaciones[];
  /** Solo un adaptador con garantías verificadas puede emitirla; no hay tal emisor productivo. */
  evidencia?: EvidenciaContinuidad | null;
}

export interface EvidenciaContinuidad {
  /** Existencia histórica acreditada, NO fecha inferida de migración o primer evento. */
  proyectoExistenteDesde: Date;
  /** Intervalos íntegros de captura obligatoria. No fusionar alrededor de gaps. */
  intervalos: ReadonlyArray<{ desde: Date; hasta: Date }>;
}

/** Solo clasificación/conteos internos; deliberadamente no define promedio ni estimación. */
export function clasificarSemanas(corte: Date, historial: HistorialSemanal) {
  const inicio = inicioVentanaSemanal(corte).getTime();
  const grupos = new Map(historial.grupos.map(g => [g.inicio.getTime(), g.finalizaciones]));
  return Array.from({ length: 5 }, (_, indice) => {
    const desde = new Date(inicio + indice * SEMANA_MS);
    const hasta = new Date(desde.getTime() + SEMANA_MS);
    const cerrada = hasta.getTime() <= corte.getTime();
    const frontera = historial.desde?.getTime();
    const estado = !historial.coberturaAcreditada || frontera === undefined
      ? 'SIN_EVIDENCIA'
      : frontera >= hasta.getTime() ? 'SIN_DATOS'
        : frontera > desde.getTime() ? 'PARCIAL'
          : cerrada ? 'COMPLETA' : 'INCOMPLETA';
    return {
      inicio: desde,
      fin: hasta,
      cerrada,
      estado,
      // No confundir un hueco de observación con cero.
      finalizaciones: estado === 'COMPLETA' ? grupos.get(desde.getTime()) ?? 0 : null,
    };
  });
}

export function ritmoNoDisponible() {
  return { disponible: false as const, motivo: 'COBERTURA_NO_ACREDITADA' as const };
}

/** No usa el booleano legado ni la frontera de migración para acreditar semanas. */
export function calcularRitmoSemanal(corte: Date, historial: HistorialSemanal) {
  const evidencia = historial.evidencia;
  if (!evidencia || evidencia.intervalos.length === 0) return ritmoNoDisponible();
  const inicio = inicioVentanaSemanal(corte).getTime();
  const grupos = new Map(historial.grupos.map(g => [g.inicio.getTime(), g.finalizaciones]));
  const semanas = Array.from({ length: 4 }, (_, indice) => {
    const desde = inicio + indice * SEMANA_MS;
    const hasta = desde + SEMANA_MS;
    const verificada = evidencia.proyectoExistenteDesde.getTime() <= desde
      && evidencia.intervalos.some(intervalo =>
        intervalo.desde.getTime() <= desde && intervalo.hasta.getTime() >= hasta);
    return { inicio: new Date(desde), fin: new Date(hasta), verificada,
      finalizaciones: verificada ? grupos.get(desde) ?? 0 : null };
  });
  const verificadas = semanas.filter(s => s.verificada);
  if (verificadas.length < 2) {
    return { disponible: false as const, motivo: 'SEMANAS_VERIFICADAS_INSUFICIENTES' as const };
  }
  const finalizaciones = verificadas.reduce((total, semana) => total + semana.finalizaciones!, 0);
  // Cociente IEEE-754 sin redondeo de negocio; conservar numerador/divisor.
  return { disponible: true as const, promedio: finalizaciones / verificadas.length,
    finalizaciones, semanasVerificadas: verificadas.length, semanas };
}
