import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RestablecerPasswordDto {
  @IsString()
  @MinLength(32, { message: 'El token no es válido' })
  @MaxLength(128)
  token!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(72, { message: 'La contraseña no puede superar 72 caracteres' })
  @Matches(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/, { message: 'La contraseña debe incluir al menos una letra' })
  @Matches(/[0-9]/, { message: 'La contraseña debe incluir al menos un número' })
  contrasenaNueva!: string;
}
