import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { AuthService, sha256Hex } from './auth.service';
import {
  USUARIO_REPOSITORY,
  UsuarioRepository,
  UsuarioEntity,
} from '../../dominio/puertos/usuario.repository';
import { PASSWORD_HASHER, PasswordHasher } from '../../dominio/puertos/password-hasher.port';
import { TOKEN_SERVICE, TokenService } from '../../dominio/puertos/token-service.port';
import { MAILER, Mailer } from '../../dominio/puertos/mailer.port';

function crearUsuario(parcial: Partial<UsuarioEntity> = {}): UsuarioEntity {
  return {
    id: 'user-1',
    email: 'ana@example.com',
    nombre: 'Ana',
    fotoUrl: null,
    passwordHash: 'hash-guardado',
    tokenVersion: 0,
    resetTokenHash: null,
    resetTokenExpires: null,
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
    actualizadoEn: new Date('2026-11-01T00:00:00.000Z'),
    ...parcial,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let usuarios: jest.Mocked<UsuarioRepository>;
  let hasher: jest.Mocked<PasswordHasher>;
  let tokens: jest.Mocked<TokenService>;
  let mailer: jest.Mocked<Mailer>;

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
    tokens = { firmar: jest.fn().mockReturnValue('jwt-firmado') };
    mailer = { enviar: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: USUARIO_REPOSITORY, useValue: usuarios },
        { provide: PASSWORD_HASHER, useValue: hasher },
        { provide: TOKEN_SERVICE, useValue: tokens },
        { provide: MAILER, useValue: mailer },
        {
          provide: ConfigService,
          useValue: {
            get: (clave: string) =>
              ({ RESET_TOKEN_TTL_MINUTES: '45', FRONTEND_URL: 'samproject://reset', JWT_EXPIRES_IN: '12h' })[
                clave
              ],
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('registro (RF-01)', () => {
    const dto = { nombre: 'Ana', email: 'Ana@Example.com ', contrasena: 'secreta1' };

    it('crea la cuenta normalizando el correo y devuelve token', async () => {
      usuarios.buscarPorEmail.mockResolvedValue(null);
      const creado = crearUsuario({ email: 'ana@example.com' });
      usuarios.crearConEspacioPersonal.mockResolvedValue(creado);

      const resp = await service.registro(dto);

      expect(usuarios.buscarPorEmail).toHaveBeenCalledWith('ana@example.com');
      expect(hasher.hash).toHaveBeenCalledWith('secreta1');
      expect(usuarios.crearConEspacioPersonal).toHaveBeenCalledWith({
        nombre: 'Ana',
        email: 'ana@example.com',
        passwordHash: 'hash-nuevo',
      });
      expect(resp.accessToken).toBe('jwt-firmado');
      expect(resp.usuario.email).toBe('ana@example.com');
      expect(resp.tokenType).toBe('Bearer');
    });

    it('rechaza correos duplicados con 409', async () => {
      usuarios.buscarPorEmail.mockResolvedValue(crearUsuario());
      await expect(service.registro(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(usuarios.crearConEspacioPersonal).not.toHaveBeenCalled();
    });
  });

  describe('login (RF-02)', () => {
    const dto = { email: 'ana@example.com', contrasena: 'secreta1' };

    it('devuelve token cuando las credenciales son válidas', async () => {
      usuarios.buscarPorEmail.mockResolvedValue(crearUsuario());
      hasher.comparar.mockResolvedValue(true);
      const resp = await service.login(dto);
      expect(resp.accessToken).toBe('jwt-firmado');
      expect(tokens.firmar).toHaveBeenCalledWith({ sub: 'user-1', tokenVersion: 0 });
    });

    it('rechaza con 401 si la contraseña no coincide', async () => {
      usuarios.buscarPorEmail.mockResolvedValue(crearUsuario());
      hasher.comparar.mockResolvedValue(false);
      await expect(service.login(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza con 401 si el correo no existe (sin filtrar existencia)', async () => {
      usuarios.buscarPorEmail.mockResolvedValue(null);
      hasher.comparar.mockResolvedValue(false);
      await expect(service.login(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout (RF-02)', () => {
    it('incrementa tokenVersion para invalidar el token actual', async () => {
      await service.logout('user-1');
      expect(usuarios.incrementarTokenVersion).toHaveBeenCalledWith('user-1');
    });
  });

  describe('recuperar (RF-03)', () => {
    it('responde genérico aunque el correo no exista', async () => {
      usuarios.buscarPorEmail.mockResolvedValue(null);
      const resp = await service.recuperar({ email: 'nadie@example.com' });
      expect(resp.mensaje).toContain('Si el correo existe');
      expect(usuarios.guardarResetToken).not.toHaveBeenCalled();
      expect(mailer.enviar).not.toHaveBeenCalled();
    });

    it('guarda el HASH del token (no el plano) y envía correo si existe el usuario', async () => {
      usuarios.buscarPorEmail.mockResolvedValue(crearUsuario());
      const resp = await service.recuperar({ email: 'ana@example.com' });

      expect(resp.mensaje).toContain('Si el correo existe');
      const [, tokenHash, expira] = usuarios.guardarResetToken.mock.calls[0]!;
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(expira.getTime()).toBeGreaterThan(Date.now());
      expect(mailer.enviar).toHaveBeenCalledTimes(1);
      const correo = mailer.enviar.mock.calls[0]![0];
      expect(correo.para).toBe('ana@example.com');
    });

    it('no falla si el SMTP falla (falla controlada)', async () => {
      usuarios.buscarPorEmail.mockResolvedValue(crearUsuario());
      mailer.enviar.mockResolvedValue(false);
      const resp = await service.recuperar({ email: 'ana@example.com' });
      expect(resp.mensaje).toContain('Si el correo existe');
    });
  });

  describe('restablecer (RF-03)', () => {
    const tokenPlano = 'a'.repeat(64);

    it('rechaza un token inválido o caducado con 400', async () => {
      usuarios.buscarPorResetTokenHash.mockResolvedValue(null);
      await expect(
        service.restablecer({ token: tokenPlano, contrasenaNueva: 'nueva1234' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      usuarios.buscarPorResetTokenHash.mockResolvedValue(
        crearUsuario({
          resetTokenHash: sha256Hex(tokenPlano),
          resetTokenExpires: new Date(Date.now() - 60_000),
        }),
      );
      await expect(
        service.restablecer({ token: tokenPlano, contrasenaNueva: 'nueva1234' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('acepta un token válido, actualiza la contraseña e invalida sesiones', async () => {
      usuarios.buscarPorResetTokenHash.mockResolvedValue(
        crearUsuario({
          resetTokenHash: sha256Hex(tokenPlano),
          resetTokenExpires: new Date(Date.now() + 60_000),
        }),
      );
      const resp = await service.restablecer({ token: tokenPlano, contrasenaNueva: 'nueva1234' });
      expect(usuarios.restablecerPassword).toHaveBeenCalledWith('user-1', 'hash-nuevo');
      expect(resp.mensaje).toContain('Contraseña actualizada');
    });

    it('busca por el HASH sha256 del token, nunca por el token plano', async () => {
      usuarios.buscarPorResetTokenHash.mockResolvedValue(null);
      await expect(
        service.restablecer({ token: tokenPlano, contrasenaNueva: 'nueva1234' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(usuarios.buscarPorResetTokenHash).toHaveBeenCalledWith(
        createHash('sha256').update(tokenPlano).digest('hex'),
      );
    });
  });
});
