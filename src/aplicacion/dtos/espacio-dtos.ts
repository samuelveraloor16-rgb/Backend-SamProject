import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { RolEspacio } from '../../dominio/puertos/espacio.repository';

export class CrearEspacioDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre del espacio es obligatorio' })
  @IsNotEmpty({ message: 'El nombre del espacio no puede estar vacío' })
  @MaxLength(120, { message: 'El nombre del espacio no puede superar 120 caracteres' })
  nombre!: string;
}

export class ActualizarEspacioDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'El nombre del espacio no puede estar vacío' })
  @MaxLength(120, { message: 'El nombre del espacio no puede superar 120 caracteres' })
  nombre?: string;

  @IsOptional()
  @IsBoolean({ message: 'asistenteActivo debe ser booleano' })
  asistenteActivo?: boolean;
}

export class CrearInvitacionDto {
  @IsEmail({}, { message: 'El correo de la invitación no es válido' })
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @IsOptional()
  @IsIn(['MIEMBRO', 'ADMINISTRADOR'], { message: 'rol debe ser MIEMBRO o ADMINISTRADOR' })
  rol?: RolEspacio;
}

export class ActualizarRolDto {
  @IsIn(['MIEMBRO', 'ADMINISTRADOR'], { message: 'rol debe ser MIEMBRO o ADMINISTRADOR' })
  rol!: RolEspacio;
}
