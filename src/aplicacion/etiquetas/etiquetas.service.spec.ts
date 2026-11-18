import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EtiquetasService } from './etiquetas.service';
import {
  ETIQUETA_REPOSITORY,
  type EtiquetaRepository,
} from '../../dominio/puertos/etiqueta.repository';
import {
  ESPACIO_REPOSITORY,
  type EspacioRepository,
  type MembresiaEntity,
} from '../../dominio/puertos/espacio.repository';

function membresia(): MembresiaEntity {
  return {
    id: 'mem-1',
    usuarioId: 'user-1',
    espacioId: 'esp-1',
    rol: 'MIEMBRO',
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
  };
}

describe('EtiquetasService', () => {
  let service: EtiquetasService;
  let etiquetas: jest.Mocked<EtiquetaRepository>;
  let espacios: jest.Mocked<Pick<EspacioRepository, 'obtenerMembresia'>>;

  beforeEach(async () => {
    etiquetas = {
      listarPorEspacio: jest.fn().mockResolvedValue([]),
      crear: jest.fn(),
      buscarPorIdsEnEspacio: jest.fn(),
      existeNombreEnEspacio: jest.fn().mockResolvedValue(false),
    };
    espacios = { obtenerMembresia: jest.fn().mockResolvedValue(membresia()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EtiquetasService,
        { provide: ETIQUETA_REPOSITORY, useValue: etiquetas },
        { provide: ESPACIO_REPOSITORY, useValue: espacios },
      ],
    }).compile();

    service = moduleRef.get(EtiquetasService);
  });

  it('crea etiqueta con nombre único', async () => {
    etiquetas.crear.mockResolvedValue({
      id: 'et-1', nombre: 'release', color: '#D5C78E', espacioId: 'esp-1', creadoEn: new Date(),
    });
    const resp = await service.crear('esp-1', 'user-1', { nombre: 'release', color: '#D5C78E' });
    expect(resp).toEqual({ id: 'et-1', nombre: 'release', color: '#D5C78E' });
  });

  it('409 si el nombre ya existe en el espacio (case-insensitive)', async () => {
    etiquetas.existeNombreEnEspacio.mockResolvedValue(true);
    await expect(
      service.crear('esp-1', 'user-1', { nombre: 'Release' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(etiquetas.crear).not.toHaveBeenCalled();
  });

  it('409 por carrera contra el unique (P2002)', async () => {
    etiquetas.crear.mockRejectedValue({ code: 'P2002' });
    await expect(service.crear('esp-1', 'user-1', { nombre: 'launch' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
