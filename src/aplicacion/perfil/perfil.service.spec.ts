import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PerfilService } from './perfil.service';
import {
  USUARIO_REPOSITORY,
  UsuarioRepository,
  UsuarioEntity,
} from '../../dominio/puertos/usuario.repository';
import { PASSWORD_HASHER, PasswordHasher } from '../../dominio/puertos/password-hasher.port';

function crearUsuario(parcial: Partial<UsuarioEntity> = {}): UsuarioEntity {
  return {
    id: 'user-1',
    email: 'ana@example.com',
    nombre: 'Ana',
    fotoUrl: null,
    passwordHash: 'hash-actual',
    tokenVersion: 3,
    resetTokenHash: null,
    resetTokenExpires: null,
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
    actualizadoEn: new Date('2026-11-01T00:00:00.000Z'),
    ...parcial,
  };
}

describe('PerfilService (RF-04)', () => {
  let service: PerfilService;
  let usuarios: jest.Mocked<UsuarioRepository>;
  let hasher: jest.Mocked<PasswordHasher>;

  beforeEach(async () => {
    usuarios = {
      buscarPorEmail: jest.fn(),
      buscarPorId: jest.fn(),
      crearConEspacioPersonal: jest.fn(),
      actualizarPerfil: jest.fn(),
      restablecerPassword: jest.fn(),
      actualizarPasswordDesdePerfil: jest.fn(),
      incrementarTokenVersion: jest.fn(),
      guardarResetToken: jest.fn(),
      buscarPorResetTokenHash: jest.fn(),
    };
    hasher = {
      hash: jest.fn().mockResolvedValue('hash-nuevo'),
      comparar: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PerfilService,
        { provide: USUARIO_REPOSITORY, useValue: usuarios },
        { provide: PASSWORD_HASHER, useValue: hasher },
      ],
    }).compile();

    service = moduleRef.get(PerfilService);
  });

  it('obtener devuelve el perfil sin datos sensibles', async () => {
    usuarios.buscarPorId.mockResolvedValue(crearUsuario());
    const perfil = await service.obtener('user-1');
    expect(perfil).toEqual({
      id: 'user-1',
      email: 'ana@example.com',
      nombre: 'Ana',
      fotoUrl: null,
      creadoEn: expect.any(Date),
    });
    expect(perfil).not.toHaveProperty('passwordHash');
  });

  it('actualizar sin cambios lanza 400', async () => {
    await expect(service.actualizar('user-1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('actualizar nombre y borrar foto (fotoUrl null)', async () => {
    usuarios.actualizarPerfil.mockResolvedValue(crearUsuario({ nombre: 'Ana María' }));
    const perfil = await service.actualizar('user-1', { nombre: 'Ana María', fotoUrl: null });
    expect(usuarios.actualizarPerfil).toHaveBeenCalledWith('user-1', {
      nombre: 'Ana María',
      fotoUrl: null,
    });
    expect(perfil.nombre).toBe('Ana María');
  });

  it('cambiar contraseña rechaza si la actual no coincide', async () => {
    usuarios.buscarPorId.mockResolvedValue(crearUsuario());
    hasher.comparar.mockResolvedValue(false);
    await expect(
      service.cambiarPassword('user-1', { contrasenaActual: 'mal', contrasenaNueva: 'nueva123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usuarios.actualizarPasswordDesdePerfil).not.toHaveBeenCalled();
  });

  it('cambiar contraseña actualiza el hash e invalida sesiones', async () => {
    usuarios.buscarPorId.mockResolvedValue(crearUsuario());
    hasher.comparar.mockResolvedValue(true);
    await service.cambiarPassword('user-1', {
      contrasenaActual: 'actual123',
      contrasenaNueva: 'nueva1234',
    });
    expect(usuarios.actualizarPasswordDesdePerfil).toHaveBeenCalledWith('user-1', 'hash-nuevo');
  });
});
