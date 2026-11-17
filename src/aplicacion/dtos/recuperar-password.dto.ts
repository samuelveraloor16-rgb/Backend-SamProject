import { IsEmail } from 'class-validator';

export class RecuperarPasswordDto {
  @IsEmail({}, { message: 'El correo no es válido' })
  email!: string;
}
