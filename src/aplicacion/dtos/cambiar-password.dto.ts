import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CambiarPasswordDto {
  @IsString()
  @MinLength(1, { message: 'La contraseña actual es obligatoria' })
  contrasenaActual!: string;

  @IsString()
  @MinLength(8, { message: 'La nueva contraseña debe tener al menos 8 caracteres' })
  @MaxLength(72, { message: 'La nueva contraseña no puede superar 72 caracteres' })
  @Matches(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/, { message: 'La nueva contraseña debe incluir al menos una letra' })
  @Matches(/[0-9]/, { message: 'La nueva contraseña debe incluir al menos un número' })
  contrasenaNueva!: string;
}
