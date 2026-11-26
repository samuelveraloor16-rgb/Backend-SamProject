import { Transform } from 'class-transformer';
import { IsIn, IsString, Length } from 'class-validator';
import type { PlataformaPush } from '../../dominio/puertos/dispositivo.repository';

export class TokenDispositivoDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 512)
  token!: string;
}

export class RegistrarDispositivoDto extends TokenDispositivoDto {
  @IsIn(['ANDROID', 'IOS'])
  plataforma!: PlataformaPush;
}

export class TransferirDispositivoDto extends TokenDispositivoDto {
  @IsString()
  codigo!: string;
}
