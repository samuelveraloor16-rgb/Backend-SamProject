// RF-18 (calendario): resolución pura de la ventana desde/hasta.
// Semántica (ver CONTRATO_API.md §7):
// - Sin params → desde = hoy (00:00 UTC), hasta = hoy + 90 días (23:59:59.999 UTC).
// - Un solo extremo presente → el otro se deriva para completar una ventana de 90 días.
// - El literal `null` en un extremo → sin límite en ese lado (también arrastra al otro
//   extremo si este se omitió: `?desde=null` sin `hasta` → sin límite alguno).
// - Fechas en UTC. `hasta < desde` → 400. El rango no tiene cap de error; 90 días es solo el default.
import { BadRequestException } from '@nestjs/common';

export interface RangoCalendario {
  /** null = sin límite inferior (inclusive, 00:00:00.000Z). */
  desde: Date | null;
  /** null = sin límite superior (inclusive, 23:59:59.999Z). */
  hasta: Date | null;
  /** Valores efectivos en YYYY-MM-DD (o null si el lado quedó abierto). Para `meta`. */
  desdeStr: string | null;
  hastaStr: string | null;
}

export const VENTANA_DEFAULT_DIAS = 90;

const FECHA_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const LITERAL_NULL = 'null';

function aUtcInicioDelDia(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function aUtcFinDelDia(iso: string): Date {
  return new Date(`${iso}T23:59:59.999Z`);
}

function sumarDiasUtc(fecha: Date, dias: number): Date {
  const copia = new Date(fecha.getTime());
  copia.setUTCDate(copia.getUTCDate() + dias);
  return copia;
}

function isoDelDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Valida `YYYY-MM-DD` como fecha de calendario real (2026-02-31 → null). */
export function parseFechaCalendario(valor: string): Date | null {
  const match = FECHA_REGEX.exec(valor);
  if (!match) return null;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime())) return null;
  // Roundtrip: rechaza fechas normalizadas (p. ej. 2026-02-31 → 2026-03-03).
  if (isoDelDia(fecha) !== valor) return null;
  return fecha;
}

export type ExtremoCalendario =
  | { tipo: 'omitido' }
  | { tipo: 'abierto' } // literal `null`
  | { tipo: 'fecha'; fecha: Date; iso: string };

/** Interpreta un query param de calendario: ausente, literal `null`, o fecha válida. */
export function interpretarExtremo(valor: string | undefined): ExtremoCalendario {
  if (valor === undefined || valor === '') return { tipo: 'omitido' };
  if (valor === LITERAL_NULL) return { tipo: 'abierto' };
  const fecha = parseFechaCalendario(valor);
  if (!fecha) {
    throw new BadRequestException('La fecha debe ser válida con formato YYYY-MM-DD (o null para sin límite)');
  }
  return { tipo: 'fecha', fecha, iso: valor };
}

/**
 * Resuelve la ventana efectiva aplicando el default de 90 días.
 * Hoy se calcula en UTC al momento de la llamada (inyectable en tests vía fake timers).
 */
export function resolverRangoCalendario(
  desdeRaw?: string,
  hastaRaw?: string,
): RangoCalendario {
  const desde = interpretarExtremo(desdeRaw);
  const hasta = interpretarExtremo(hastaRaw);

  const hoyIso = isoDelDia(new Date());
  const hoyInicio = aUtcInicioDelDia(hoyIso);

  // Ambos omitidos → ventana [hoy, hoy+90d].
  if (desde.tipo === 'omitido' && hasta.tipo === 'omitido') {
    const fin = sumarDiasUtc(hoyInicio, VENTANA_DEFAULT_DIAS);
    return {
      desde: hoyInicio,
      hasta: aUtcFinDelDia(isoDelDia(fin)),
      desdeStr: hoyIso,
      hastaStr: isoDelDia(fin),
    };
  }

  const resolverLado = (propio: ExtremoCalendario, otro: ExtremoCalendario, esDesde: boolean): RangoCalendario['desde' | 'hasta'] => {
    if (propio.tipo === 'abierto') return null;
    if (propio.tipo === 'fecha') return esDesde ? aUtcInicioDelDia(propio.iso) : aUtcFinDelDia(propio.iso);
    // Omitido: derivar del otro extremo. Si el otro está abierto o ausente, este lado queda abierto.
    if (otro.tipo !== 'fecha') return null;
    const base = otro.fecha;
    const derivado = sumarDiasUtc(base, esDesde ? -VENTANA_DEFAULT_DIAS : VENTANA_DEFAULT_DIAS);
    return esDesde ? aUtcInicioDelDia(isoDelDia(derivado)) : aUtcFinDelDia(isoDelDia(derivado));
  };

  const desdeFecha = resolverLado(desde, hasta, true);
  const hastaFecha = resolverLado(hasta, desde, false);

  if (desdeFecha && hastaFecha && hastaFecha.getTime() < desdeFecha.getTime()) {
    throw new BadRequestException('hasta no puede ser anterior a desde');
  }

  return {
    desde: desdeFecha,
    hasta: hastaFecha,
    desdeStr: desdeFecha ? isoDelDia(desdeFecha) : null,
    hastaStr: hastaFecha ? isoDelDia(hastaFecha) : null,
  };
}
