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
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginacionDto } from '../comun/paginacion';

export class ListarProyectosQueryDto extends PaginacionDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  q?: string;

  // defecto false: solo no archivados
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  archivados: boolean = false;
}

export class CrearProyectoDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre del proyecto es obligatorio' })
  @IsNotEmpty({ message: 'El nombre del proyecto no puede estar vacío' })
  @MaxLength(120, { message: 'El nombre del proyecto no puede superar 120 caracteres' })
  nombre!: string;

  @IsOptional()
  @ValidateIf((o) => o.descripcion !== null)
  @IsString()
  @MaxLength(2000)
  descripcion?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.fechaInicio !== null)
  @IsDateString({}, { message: 'fechaInicio debe ser una fecha ISO 8601' })
  fechaInicio?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.fechaFin !== null)
  @IsDateString({}, { message: 'fechaFin debe ser una fecha ISO 8601' })
  fechaFin?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  miembros?: string[];
}

export class ActualizarProyectoDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'El nombre del proyecto no puede estar vacío' })
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @ValidateIf((o) => o.descripcion !== null)
  @IsString()
  @MaxLength(2000)
  descripcion?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.fechaInicio !== null)
  @IsDateString({}, { message: 'fechaInicio debe ser una fecha ISO 8601' })
  fechaInicio?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.fechaFin !== null)
  @IsDateString({}, { message: 'fechaFin debe ser una fecha ISO 8601' })
  fechaFin?: string | null;

  // Reemplaza el conjunto completo de miembros del proyecto (IDs de usuarios del espacio).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  miembros?: string[];
}

export class ArchivarProyectoDto {
  @IsBoolean({ message: 'archivado debe ser booleano' })
  archivado!: boolean;
}
