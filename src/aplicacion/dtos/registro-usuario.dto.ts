import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegistroUsuarioDto {
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(80, { message: 'El nombre no puede superar 80 caracteres' })
  nombre!: string;

  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(255)
  email!: string;

  // bcrypt opera sobre un máximo de 72 bytes; se limita la longitud y se exige fuerza mínima razonable.
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(72, { message: 'La contraseña no puede superar 72 caracteres' })
  @Matches(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/, { message: 'La contraseña debe incluir al menos una letra' })
  @Matches(/[0-9]/, { message: 'La contraseña debe incluir al menos un número' })
  contrasena!: string;
}
