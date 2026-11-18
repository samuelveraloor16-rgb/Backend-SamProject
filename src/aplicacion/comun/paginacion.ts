import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Paginación estándar de la API (sección 0 de docs/orquestacion/CONTRATO_API.md):
// page 1-based (defecto 1), pageSize por defecto 20, máximo 100.
export class PaginacionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero' })
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize debe ser un número entero' })
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

export interface MetaPaginacion {
  pagina: number;
  tamanoPagina: number;
  total: number;
  totalPaginas: number;
}

export interface Envelope<T> {
  datos: T[];
  meta: MetaPaginacion;
}

/** Envelope estándar { datos, meta } (sección 0 del contrato). */
export function envelope<T>(datos: T[], total: number, pagina: number, tamanoPagina: number): Envelope<T> {
  return {
    datos,
    meta: {
      pagina,
      tamanoPagina,
      total,
      totalPaginas: tamanoPagina === 0 ? 0 : Math.ceil(total / tamanoPagina),
    },
  };
}

/** Paginación en memoria para volúmenes pequeños (Fase 1): corta según page/pageSize. */
export function paginarEnMemoria<T>(items: T[], pagina: number, tamanoPagina: number): { datos: T[]; total: number } {
  const total = items.length;
  const inicio = (pagina - 1) * tamanoPagina;
  return { datos: items.slice(inicio, inicio + tamanoPagina), total };
}
