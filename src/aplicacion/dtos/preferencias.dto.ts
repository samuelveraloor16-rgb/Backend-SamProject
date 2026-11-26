import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { CambioPreferencia, TIPOS_PREFERENCIA, TipoPreferencia } from '../../dominio/puertos/preferencias.repository';

const invalido = (): never => { throw new BadRequestException('Preferencias de notificaciones inválidas'); };
const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

// Validación explícita: no permite coerción ni IsOptional(null).
export class PreferenciasDto {
  static parse(body: unknown): CambioPreferencia[] {
    if (!objeto(body) || Object.keys(body).length !== 1 || !Array.isArray(body.preferencias)) return invalido();
    const filas = body.preferencias;
    if (filas.length < 1 || filas.length > 5) return invalido();
    const vistos = new Set<string>();
    return filas.map((f: unknown) => {
      if (!objeto(f) || typeof f.tipo !== 'string' || !TIPOS_PREFERENCIA.includes(f.tipo as TipoPreferencia) || vistos.has(f.tipo)) return invalido();
      const canales = Object.keys(f).filter(k => k !== 'tipo');
      if (!canales.length || canales.some(k => !['inApp', 'correo', 'push'].includes(k) || typeof f[k] !== 'boolean')) return invalido();
      if (f.tipo === 'MENCION' && f.inApp === false) return invalido();
      vistos.add(f.tipo);
      return { ...f } as CambioPreferencia;
    });
  }
}
@Injectable()
export class PreferenciasPipe implements PipeTransform {
  transform(body: unknown) { return PreferenciasDto.parse(body); }
}
