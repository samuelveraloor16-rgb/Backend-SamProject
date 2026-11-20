import { BadRequestException } from '@nestjs/common';
import { ComentariosService } from './comentarios.service';
import type { ComentariosRepository } from '../../dominio/puertos/comentarios.repository';

describe('ComentariosService', () => {
  const crear = jest.fn();
  const service = new ComentariosService({ crear } as unknown as ComentariosRepository);
  beforeEach(() => crear.mockReset());
  it('rechaza claves y menciones inválidas sin invocar persistencia', () => {
    expect(() => service.crear('t', 'u', 'hola', undefined)).toThrow(BadRequestException);
    expect(() => service.crear('t', 'u', '@[mal', 'clave')).toThrow(BadRequestException);
    expect(crear).not.toHaveBeenCalled();
  });
  it('pasa menciones únicas respetando orden y texto original', () => {
    service.crear('t', 'u', ' @[b] @[a] @[b] ', 'clave');
    expect(crear).toHaveBeenCalledWith('t', 'u', ' @[b] @[a] @[b] ', 'clave', ['b', 'a']);
  });
});
