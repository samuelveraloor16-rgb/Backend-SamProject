import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EspaciosService } from './espacios.service';
import {
  ESPACIO_REPOSITORY,
  type EspacioRepository,
  type EspacioEntity,
  type MembresiaEntity,
  type InvitacionEntity,
} from '../../dominio/puertos/espacio.repository';
import {
  USUARIO_REPOSITORY,
  type UsuarioRepository,
} from '../../dominio/puertos/usuario.repository';
import {
  TAREA_REPOSITORY,
  type TareaRepository,
} from '../../dominio/puertos/tarea.repository';
import { MAILER, type Mailer } from '../../dominio/puertos/mailer.port';

function espacio(parcial: Partial<EspacioEntity> = {}): EspacioEntity {
  return {
    id: 'esp-1',
    nombre: 'Equipo Marketing',
    esPersonal: false,
    asistenteActivo: true,
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
    actualizadoEn: new Date('2026-11-01T00:00:00.000Z'),
    ...parcial,
  };
}

function membresia(parcial: Partial<MembresiaEntity> = {}): MembresiaEntity {
  return {
    id: 'mem-1',
    usuarioId: 'user-1',
    espacioId: 'esp-1',
    rol: 'ADMINISTRADOR',
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
    ...parcial,
  };
}

function invitacion(parcial: Partial<InvitacionEntity> = {}): InvitacionEntity {
  return {
    id: 'inv-1',
    tokenHash: 'hash',
    email: 'nuevo@example.com',
    rol: 'MIEMBRO',
    espacioId: 'esp-1',
    invitadoPorId: 'user-1',
    expiraEn: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    aceptadaEn: null,
    creadoEn: new Date(),
    ...parcial,
  };
}

describe('EspaciosService', () => {
  let service: EspaciosService;
  let espacios: jest.Mocked<EspacioRepository>;
  let tareas: jest.Mocked<TareaRepository>;
  let usuarios: jest.Mocked<UsuarioRepository>;
  let mailer: jest.Mocked<Mailer>;

  beforeEach(async () => {
    espacios = {
      listarDeUsuario: jest.fn(),
      buscarPorId: jest.fn(),
      obtenerMembresia: jest.fn(),
      crearConAdmin: jest.fn(),
      actualizar: jest.fn(),
      contarMiembros: jest.fn(),
      contarAdministradores: jest.fn(),
      buscarUsuarioPorEmail: jest.fn(),
      crearInvitacion: jest.fn(),
      buscarInvitacionPorTokenHash: jest.fn(),
      aceptarInvitacion: jest.fn(),
      actualizarRolMembresia: jest.fn(),
      eliminarMembresia: jest.fn(),
    };
    tareas = {
      listarCalendario: jest.fn().mockResolvedValue([]),
      listar: jest.fn().mockResolvedValue([]),
      buscarPorId: jest.fn(),
      listarSubtareas: jest.fn().mockResolvedValue([]),
      crear: jest.fn(),
      crearSubtareaAutorizada: jest.fn(),
      actualizar: jest.fn(),
      eliminar: jest.fn(),
      moverConSubtareas: jest.fn(),
    };
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
    mailer = { enviar: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EspaciosService,
        { provide: ESPACIO_REPOSITORY, useValue: espacios },
        { provide: TAREA_REPOSITORY, useValue: tareas },
        { provide: USUARIO_REPOSITORY, useValue: usuarios },
        { provide: MAILER, useValue: mailer },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    service = moduleRef.get(EspaciosService);
  });

  describe('crear (RF-06)', () => {
    it('crea espacio de equipo con el creador como ADMINISTRADOR', async () => {
      espacios.crearConAdmin.mockResolvedValue(espacio());
      const resp = await service.crear('user-1', { nombre: '  Equipo Marketing ' });
      expect(espacios.crearConAdmin).toHaveBeenCalledWith({
        nombre: 'Equipo Marketing',
        creadorId: 'user-1',
      });
      expect(resp.miRol).toBe('ADMINISTRADOR');
      expect(resp.totalMiembros).toBe(1);
      expect(resp.esPersonal).toBe(false);
    });
  });

  describe('listar (RF-05)', () => {
    it('ordena personales primero y pagina en envelope', async () => {
      espacios.listarDeUsuario.mockResolvedValue([
        { espacio: espacio({ id: 'a', esPersonal: false, creadoEn: new Date('2026-01-01') }), miRol: 'MIEMBRO', totalMiembros: 3 },
        { espacio: espacio({ id: 'b', esPersonal: true, creadoEn: new Date('2026-06-01') }), miRol: 'ADMINISTRADOR', totalMiembros: 1 },
      ]);
      const resp = await service.listar('user-1', { page: 1, pageSize: 20 });
      expect(resp.datos.map((e) => e.id)).toEqual(['b', 'a']);
      expect(resp.meta).toEqual({ pagina: 1, tamanoPagina: 20, total: 2, totalPaginas: 1 });
    });
  });

  describe('actualizar (RF-08)', () => {
    it('rechaza 403 si el usuario no es administrador', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia({ rol: 'MIEMBRO' }));
      await expect(
        service.actualizar('esp-1', 'user-1', { asistenteActivo: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('permite desactivar el asistente al administrador y devuelve el espacio', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia());
      espacios.actualizar.mockResolvedValue(espacio({ asistenteActivo: false }));
      espacios.contarMiembros.mockResolvedValue(2);
      const resp = await service.actualizar('esp-1', 'user-1', { asistenteActivo: false });
      expect(espacios.actualizar).toHaveBeenCalledWith('esp-1', { asistenteActivo: false });
      expect(resp.asistenteActivo).toBe(false);
    });

    it('rechaza sin campos con 400', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia());
      await expect(service.actualizar('esp-1', 'user-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('invitar (RF-06)', () => {
    it('solo ADMINISTRADOR puede invitar (403 para MIEMBRO)', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia({ rol: 'MIEMBRO' }));
      await expect(
        service.invitar('esp-1', 'user-1', { email: 'nuevo@example.com' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(espacios.crearInvitacion).not.toHaveBeenCalled();
    });

    it('409 si el correo ya es miembro del espacio', async () => {
      espacios.obtenerMembresia
        .mockResolvedValueOnce(membresia()) // asegurar admin
        .mockResolvedValueOnce(membresia({ usuarioId: 'otro' })); // ya miembro
      espacios.buscarPorId.mockResolvedValue(espacio());
      espacios.buscarUsuarioPorEmail.mockResolvedValue({ id: 'otro', email: 'nuevo@example.com' });
      await expect(
        service.invitar('esp-1', 'user-1', { email: 'nuevo@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('crea la invitación, envía correo y NO devuelve el token', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia());
      espacios.buscarPorId.mockResolvedValue(espacio());
      espacios.buscarUsuarioPorEmail.mockResolvedValue(null);
      espacios.crearInvitacion.mockImplementation(async (datos) => invitacion({ ...datos, id: 'inv-9' }));
      const resp = await service.invitar('esp-1', 'user-1', { email: 'nuevo@example.com' });
      expect(resp).toEqual(
        expect.objectContaining({ id: 'inv-9', email: 'nuevo@example.com', rol: 'MIEMBRO' }),
      );
      expect(resp).not.toHaveProperty('token');
      expect(mailer.enviar).toHaveBeenCalledTimes(1);
      expect(espacios.crearInvitacion).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'nuevo@example.com', rol: 'MIEMBRO', espacioId: 'esp-1' }),
      );
    });

    it('la invitación se crea igualmente si SMTP falla (falla controlada)', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia());
      espacios.buscarPorId.mockResolvedValue(espacio());
      espacios.buscarUsuarioPorEmail.mockResolvedValue(null);
      espacios.crearInvitacion.mockImplementation(async (datos) => invitacion({ ...datos, id: 'inv-10' }));
      mailer.enviar.mockResolvedValue(false);
      const resp = await service.invitar('esp-1', 'user-1', { email: 'nuevo@example.com' });
      expect(resp.id).toBe('inv-10');
    });
  });

  describe('aceptarInvitacion (RF-06)', () => {
    const tokenPlano = 'a'.repeat(64);

    it('acepta con token válido: crea membresía y marca invitación usada', async () => {
      espacios.buscarInvitacionPorTokenHash.mockResolvedValue(invitacion({ rol: 'MIEMBRO' }));
      usuarios.buscarPorId.mockResolvedValue({
        id: 'user-2', email: 'nuevo@example.com', nombre: 'Nuevo', fotoUrl: null,
        passwordHash: 'h', tokenVersion: 0, resetTokenHash: null, resetTokenExpires: null,
        creadoEn: new Date(), actualizadoEn: new Date(),
      });
      espacios.obtenerMembresia.mockResolvedValue(null);
      espacios.buscarPorId.mockResolvedValue(espacio());
      espacios.aceptarInvitacion.mockResolvedValue(membresia({ usuarioId: 'user-2', rol: 'MIEMBRO' }));
      const resp = await service.aceptarInvitacion(tokenPlano, 'user-2');
      expect(resp.mensaje).toBe('Invitación aceptada');
      expect(resp.espacio).toEqual({ id: 'esp-1', nombre: 'Equipo Marketing', miRol: 'MIEMBRO' });
      expect(espacios.aceptarInvitacion).toHaveBeenCalledWith(
        expect.objectContaining({ invitacionId: 'inv-1', usuarioId: 'user-2', rol: 'MIEMBRO' }),
      );
    });

    it('rechaza token inexistente con 400', async () => {
      espacios.buscarInvitacionPorTokenHash.mockResolvedValue(null);
      await expect(service.aceptarInvitacion(tokenPlano, 'user-2')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rechaza token caducado con 400', async () => {
      espacios.buscarInvitacionPorTokenHash.mockResolvedValue(
        invitacion({ expiraEn: new Date(Date.now() - 1000) }),
      );
      await expect(service.aceptarInvitacion(tokenPlano, 'user-2')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rechaza token ya usado con 400', async () => {
      espacios.buscarInvitacionPorTokenHash.mockResolvedValue(
        invitacion({ aceptadaEn: new Date() }),
      );
      await expect(service.aceptarInvitacion(tokenPlano, 'user-2')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rechaza si el correo autenticado no coincide (403)', async () => {
      espacios.buscarInvitacionPorTokenHash.mockResolvedValue(invitacion());
      usuarios.buscarPorId.mockResolvedValue({
        id: 'user-3', email: 'otro@example.com', nombre: 'Otro', fotoUrl: null,
        passwordHash: 'h', tokenVersion: 0, resetTokenHash: null, resetTokenExpires: null,
        creadoEn: new Date(), actualizadoEn: new Date(),
      });
      await expect(service.aceptarInvitacion(tokenPlano, 'user-3')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(espacios.aceptarInvitacion).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si el usuario ya es miembro', async () => {
      espacios.buscarInvitacionPorTokenHash.mockResolvedValue(invitacion());
      usuarios.buscarPorId.mockResolvedValue({
        id: 'user-2', email: 'nuevo@example.com', nombre: 'Nuevo', fotoUrl: null,
        passwordHash: 'h', tokenVersion: 0, resetTokenHash: null, resetTokenExpires: null,
        creadoEn: new Date(), actualizadoEn: new Date(),
      });
      espacios.obtenerMembresia.mockResolvedValue(membresia({ usuarioId: 'user-2' }));
      await expect(service.aceptarInvitacion(tokenPlano, 'user-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('quitarMiembro (RF-07)', () => {
    it('403 si el actor no es administrador', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia({ rol: 'MIEMBRO' }));
      await expect(service.quitarMiembro('esp-1', 'user-1', 'user-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('404 si el objetivo no es miembro', async () => {
      espacios.obtenerMembresia
        .mockResolvedValueOnce(membresia()) // actor admin
        .mockResolvedValueOnce(null); // objetivo no encontrado
      espacios.buscarPorId.mockResolvedValue(espacio());
      await expect(service.quitarMiembro('esp-1', 'user-1', 'user-2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('400 si se intenta quitar al último ADMINISTRADOR', async () => {
      espacios.obtenerMembresia
        .mockResolvedValueOnce(membresia()) // actor admin
        .mockResolvedValueOnce(membresia({ usuarioId: 'user-2', rol: 'ADMINISTRADOR' })); // objetivo
      espacios.buscarPorId.mockResolvedValue(espacio());
      espacios.contarAdministradores.mockResolvedValue(1);
      await expect(service.quitarMiembro('esp-1', 'user-1', 'user-2')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('400 en espacio personal', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia());
      espacios.buscarPorId.mockResolvedValue(espacio({ esPersonal: true }));
      await expect(service.quitarMiembro('esp-1', 'user-1', 'user-2')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('elimina la membresía en el caso feliz', async () => {
      espacios.obtenerMembresia
        .mockResolvedValueOnce(membresia())
        .mockResolvedValueOnce(membresia({ usuarioId: 'user-2', rol: 'MIEMBRO' }));
      espacios.buscarPorId.mockResolvedValue(espacio());
      espacios.eliminarMembresia.mockResolvedValue(true);
      await service.quitarMiembro('esp-1', 'user-1', 'user-2');
      expect(espacios.eliminarMembresia).toHaveBeenCalledWith('esp-1', 'user-2');
    });
  });

  describe('cambiarRol (RF-07)', () => {
    it('400 al degradar al último ADMINISTRADOR', async () => {
      espacios.obtenerMembresia
        .mockResolvedValueOnce(membresia()) // actor admin
        .mockResolvedValueOnce(membresia({ usuarioId: 'user-2', rol: 'ADMINISTRADOR' })); // objetivo
      espacios.contarAdministradores.mockResolvedValue(1);
      await expect(
        service.cambiarRol('esp-1', 'user-1', 'user-2', { rol: 'MIEMBRO' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('permite ascender a ADMINISTRADOR', async () => {
      espacios.obtenerMembresia
        .mockResolvedValueOnce(membresia())
        .mockResolvedValueOnce(membresia({ usuarioId: 'user-2', rol: 'MIEMBRO' }));
      espacios.actualizarRolMembresia.mockResolvedValue(membresia({ usuarioId: 'user-2', rol: 'ADMINISTRADOR' }));
      const resp = await service.cambiarRol('esp-1', 'user-1', 'user-2', { rol: 'ADMINISTRADOR' });
      expect(resp).toEqual({ usuarioId: 'user-2', espacioId: 'esp-1', rol: 'ADMINISTRADOR' });
    });
  });

  describe('salir (RF-07)', () => {
    it('400 al salir de un espacio personal', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia());
      espacios.buscarPorId.mockResolvedValue(espacio({ esPersonal: true }));
      await expect(service.salir('esp-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si es el único ADMINISTRADOR y quedan otros miembros', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia());
      espacios.buscarPorId.mockResolvedValue(espacio());
      espacios.contarAdministradores.mockResolvedValue(1);
      espacios.contarMiembros.mockResolvedValue(3);
      await expect(service.salir('esp-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('permite salir a un MIEMBRO', async () => {
      espacios.obtenerMembresia.mockResolvedValue(membresia({ rol: 'MIEMBRO' }));
      espacios.buscarPorId.mockResolvedValue(espacio());
      espacios.eliminarMembresia.mockResolvedValue(true);
      await service.salir('esp-1', 'user-1');
      expect(espacios.eliminarMembresia).toHaveBeenCalledWith('esp-1', 'user-1');
    });
  });
});
