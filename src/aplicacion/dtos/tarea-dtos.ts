import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  MinLength,
} from 'class-validator';
import { PaginacionDto } from '../comun/paginacion';
import type {
  EstadoTarea,
  OrdenTareas,
  PrioridadTarea,
} from '../../dominio/puertos/tarea.repository';

export class ListarTareasQueryDto extends PaginacionDto {
  @IsOptional()
  @IsIn(['PENDIENTE', 'EN_CURSO', 'HECHA'], { message: 'estado debe ser PENDIENTE, EN_CURSO o HECHA' })
  estado?: EstadoTarea;

  @IsOptional()
  @IsIn(['BAJA', 'MEDIA', 'ALTA', 'URGENTE'], { message: 'prioridad debe ser BAJA, MEDIA, ALTA o URGENTE' })
  prioridad?: PrioridadTarea;

  @IsOptional()
  @IsString()
  responsableId?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  q?: string;

  // RF-15: ?vencidas=true devuelve solo vencidas (regla calculada). Cualquier otro valor no filtra.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  vencidas?: boolean;

  @IsOptional()
  @IsIn(['creadoEn', 'fechaLimite', 'prioridad'], { message: 'orden debe ser creadoEn, fechaLimite o prioridad' })
  orden: OrdenTareas = 'creadoEn';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'direccion debe ser asc o desc' })
  direccion?: 'asc' | 'desc';
}

export class CrearTareaDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El título es obligatorio' })
  @IsNotEmpty({ message: 'El título no puede estar vacío' })
  @MinLength(1)
  @MaxLength(200, { message: 'El título no puede superar 200 caracteres' })
  titulo!: string;

  @IsOptional()
  @ValidateIf((o) => o.descripcion !== null)
  @IsString()
  @MaxLength(5000)
  descripcion?: string | null;

  @IsOptional()
  @IsIn(['BAJA', 'MEDIA', 'ALTA', 'URGENTE'], { message: 'prioridad debe ser BAJA, MEDIA, ALTA o URGENTE' })
  prioridad?: PrioridadTarea;

  @IsOptional()
  @ValidateIf((o) => o.fechaLimite !== null)
  @IsDateString({}, { message: 'fechaLimite debe ser una fecha ISO 8601' })
  fechaLimite?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.responsableId !== null)
  @IsString()
  responsableId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  etiquetas?: string[];
}

export class ActualizarTareaDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'El título no puede estar vacío' })
  @MaxLength(200)
  titulo?: string;

  // null explícito borra la descripción
  @IsOptional()
  @ValidateIf((o) => o.descripcion !== null)
  @IsString()
  @MaxLength(5000)
  descripcion?: string | null;

  @IsOptional()
  @IsIn(['BAJA', 'MEDIA', 'ALTA', 'URGENTE'], { message: 'prioridad debe ser BAJA, MEDIA, ALTA o URGENTE' })
  prioridad?: PrioridadTarea;

  // null explícito borra la fecha límite
  @IsOptional()
  @ValidateIf((o) => o.fechaLimite !== null)
  @IsDateString({}, { message: 'fechaLimite debe ser una fecha ISO 8601' })
  fechaLimite?: string | null;

  // null explícito desasigna al responsable
  @IsOptional()
  @ValidateIf((o) => o.responsableId !== null)
  @IsString()
  responsableId?: string | null;

  // Reemplaza el conjunto completo de etiquetas
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  etiquetas?: string[];
}

export class CrearSubtareaDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El título es obligatorio' })
  @IsNotEmpty({ message: 'El título no puede estar vacío' })
  @MaxLength(200, { message: 'El título no puede superar 200 caracteres' })
  titulo!: string;

  @IsOptional()
  @ValidateIf((o) => o.descripcion !== null)
  @IsString()
  @MaxLength(5000)
  descripcion?: string | null;

  @IsOptional()
  @IsIn(['BAJA', 'MEDIA', 'ALTA', 'URGENTE'], { message: 'prioridad debe ser BAJA, MEDIA, ALTA o URGENTE' })
  prioridad?: PrioridadTarea;

  @IsOptional()
  @ValidateIf((o) => o.fechaLimite !== null)
  @IsDateString({}, { message: 'fechaLimite debe ser una fecha ISO 8601' })
  fechaLimite?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.responsableId !== null)
  @IsString()
  responsableId?: string | null;
}

export class CambiarEstadoDto {
  @IsIn(['PENDIENTE', 'EN_CURSO', 'HECHA'], { message: 'estado debe ser PENDIENTE, EN_CURSO o HECHA' })
  estado!: EstadoTarea;
}

export class TareaRapidaDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El título es obligatorio' })
  @IsNotEmpty({ message: 'El título no puede estar vacío' })
  @MaxLength(200, { message: 'El título no puede superar 200 caracteres' })
  titulo!: string;

  @IsOptional()
  @IsString()
  espacioId?: string;
}

export class MoverTareaDto {
  @IsString()
  @IsNotEmpty({ message: 'proyectoId es obligatorio' })
  proyectoId!: string;
}

export class CrearEtiquetaDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre de la etiqueta es obligatorio' })
  @IsNotEmpty({ message: 'El nombre de la etiqueta no puede estar vacío' })
  @MaxLength(60, { message: 'El nombre de la etiqueta no puede superar 60 caracteres' })
  nombre!: string;

  @IsOptional()
  @ValidateIf((o) => o.color !== null)
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'El color debe ser un hex #RRGGBB (p. ej. #D5C78E)' })
  color?: string | null;
}
