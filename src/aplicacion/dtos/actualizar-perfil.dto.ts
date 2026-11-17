import { IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class ActualizarPerfilDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(80)
  nombre?: string;

  // null explícito borra la foto; string vacío también se interpreta como borrar (se normaliza en servicio).
  @IsOptional()
  @ValidateIf((o) => o.fotoUrl !== null)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, {
    message: 'La URL de la foto no es válida',
  })
  @MaxLength(2048)
  fotoUrl?: string | null;
}
