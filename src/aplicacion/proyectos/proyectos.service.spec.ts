import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProyectosService } from './proyectos.service';
import {
  PROYECTO_REPOSITORY,
  type ProyectoRepository,
  type ProyectoConMiembros,
} from '../../dominio/puertos/proyecto.repository';
import {
  ESPACIO_REPOSITORY,
  type EspacioRepository,
  type MembresiaEntity,
} from '../../dominio/puertos/espacio.repository';

function proyecto(parcial: Partial<ProyectoConMiembros> = {}): ProyectoConMiembros {
  return {
    id: 'proy-1',
    nombre: 'Lanzamiento Q1',
    descripcion: null,
    fechaInicio: null,
    fechaFin: null,
    archivado: false,
    esBandejaDeEntrada: false,
    espacioId: 'esp-1',
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
    actualizadoEn: new Date('2026-11-01T00:00:00.000Z'),
    eliminadoEn: null,
    miembros: [{ id: 'user-1', nombre: 'Ana', email: 'ana@example.com' }],
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

describe('ProyectosService', () => {
  let service: ProyectosService;
  let proyectos: jest.Mocked<ProyectoRepository>;
  let espacios: jest.Mocked<Pick<EspacioRepository, 'obtenerMembresia'>>;

  beforeEach(async () => {
    proyectos = {
      listarPorEspacio: jest.fn(),
      buscarPorId: jest.fn(),
      filtrarIdsMiembrosDelEspacio: jest.fn(),
      crear: jest.fn(),
      actualizar: jest.fn(),
      actualizarAutorizado: jest.fn(),
      reemplazarMiembros: jest.fn(),
      eliminar: jest.fn(),
      obtenerBandeja: jest.fn(),
      tareasContables: jest.fn().mockResolvedValue([]),
    };
    espacios = {
      obtenerMembresia: jest.fn().mockResolvedValue(membresia()),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProyectosService,
        { provide: PROYECTO_REPOSITORY, useValue: proyectos },
        { provide: ESPACIO_REPOSITORY, useValue: espacios },
      ],
    }).compile();

    service = moduleRef.get(ProyectosService);
  });

  describe('crear (RF-09/RF-10)', () => {
    it('crea el proyecto con el creador como miembro y progreso 0', async () => {
      proyectos.filtrarIdsMiembrosDelEspacio.mockResolvedValue(['user-1']);
      proyectos.crear.mockResolvedValue(proyecto());
      const resp = await service.crear('esp-1', 'user-1', { nombre: 'Lanzamiento Q1' });
      expect(proyectos.crear).toHaveBeenCalledWith(
        expect.objectContaining({ miembrosIds: ['user-1'], espacioId: 'esp-1' }),
      );
      expect(resp.progreso).toBe(0);
    });

    it('auto-añade al creador aunque venga en miembros sin repetirlo', async () => {
      proyectos.filtrarIdsMiembrosDelEspacio.mockResolvedValue(['user-1', 'user-2']);
      proyectos.crear.mockResolvedValue(proyecto());
      await service.crear('esp-1', 'user-1', { nombre: 'X', miembros: ['user-1', 'user-2', 'user-2'] });
      expect(proyectos.crear).toHaveBeenCalledWith(
        expect.objectContaining({ miembrosIds: ['user-1', 'user-2'] }),
      );
    });

    it('rechaza fechaFin anterior a fechaInicio (400)', async () => {
      await expect(
        service.crear('esp-1', 'user-1', {
          nombre: 'X',
          fechaInicio: '2026-12-31T00:00:00.000Z',
          fechaFin: '2026-11-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(proyectos.crear).not.toHaveBeenCalled();
    });

    it('rechaza miembros que no son del espacio (400)', async () => {
      proyectos.filtrarIdsMiembrosDelEspacio.mockResolvedValue(['user-1']); // user-9 no vuelve
      await expect(
        service.crear('esp-1', 'user-1', { nombre: 'X', miembros: ['user-9'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 si el espacio es ajeno', async () => {
      espacios.obtenerMembresia.mockResolvedValue(null);
      await expect(service.crear('esp-1', 'user-x', { nombre: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('eliminar (RF-09)', () => {
    it('403 si el actor es MIEMBRO (solo ADMINISTRADOR elimina)', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto());
      espacios.obtenerMembresia.mockResolvedValue(membresia({ rol: 'MIEMBRO' }));
      await expect(service.eliminar('proy-1', 'user-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(proyectos.eliminar).not.toHaveBeenCalled();
    });

    it('400 al intentar eliminar la Bandeja de entrada', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto({ esBandejaDeEntrada: true }));
      espacios.obtenerMembresia.mockResolvedValue(membresia()); // admin
      await expect(service.eliminar('proy-bandeja', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(proyectos.eliminar).not.toHaveBeenCalled();
    });

    it('elimina en cascada cuando el actor es ADMINISTRADOR', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto());
      espacios.obtenerMembresia.mockResolvedValue(membresia({ rol: 'ADMINISTRADOR' }));
      await service.eliminar('proy-1', 'user-1');
      expect(proyectos.eliminar).toHaveBeenCalledWith('proy-1');
    });
  });

  describe('archivar (RF-09)', () => {
    it('400 al intentar archivar la Bandeja de entrada', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto({ esBandejaDeEntrada: true }));
      await expect(
        service.archivar('proy-bandeja', 'user-1', { archivado: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un MIEMBRO puede archivar (permiso ✔ en tabla de roles)', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto());
      espacios.obtenerMembresia.mockResolvedValue(membresia({ rol: 'MIEMBRO' }));
      proyectos.actualizar.mockResolvedValue(proyecto({ archivado: true }));
      const resp = await service.archivar('proy-1', 'user-1', { archivado: true });
      expect(resp.archivado).toBe(true);
    });
  });

  describe('actualizar (RF-09)', () => {
    it('rechaza null en nombre o miembros sin escribir incluso sin ValidationPipe', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto());
      await expect(service.actualizar('proy-1', 'user-1', { nombre: null } as never)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.actualizar('proy-1', 'user-1', { miembros: null } as never)).rejects.toBeInstanceOf(BadRequestException);
      expect(proyectos.actualizarAutorizado).not.toHaveBeenCalled();
    });
    it('delega campos y miembros a una sola operación autorizada y propaga el rechazo', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto());
      proyectos.actualizarAutorizado.mockRejectedValue(new BadRequestException());
      await expect(service.actualizar('proy-1', 'user-1', { nombre: 'Otro', miembros: ['ajeno'] })).rejects.toBeInstanceOf(BadRequestException);
      expect(proyectos.actualizarAutorizado).toHaveBeenCalledWith('proy-1', 'user-1', { nombre: 'Otro' }, ['ajeno']);
      expect(proyectos.actualizar).not.toHaveBeenCalled();
      expect(proyectos.reemplazarMiembros).not.toHaveBeenCalled();
    });
    it('400 si el proyecto está archivado', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto({ archivado: true }));
      await expect(
        service.actualizar('proy-1', 'user-1', { nombre: 'Otro nombre' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si no hay campos en el body', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto());
      await expect(service.actualizar('proy-1', 'user-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('reemplaza miembros validándolos contra el espacio', async () => {
      proyectos.buscarPorId
        .mockResolvedValueOnce(proyecto()) // exigirProyectoVisible
        .mockResolvedValueOnce(proyecto()); // tras la actualización
      proyectos.actualizarAutorizado.mockResolvedValue(proyecto());
      await service.actualizar('proy-1', 'user-1', { miembros: ['user-2'] });
      expect(proyectos.actualizarAutorizado).toHaveBeenCalledWith('proy-1', 'user-1', {}, ['user-2']);
    });
  });

  describe('progreso (RF-11)', () => {
    it('usa únicamente tareas contables (padre con subtareas excluido por el repo)', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto());
      proyectos.tareasContables.mockResolvedValue([
        { estado: 'HECHA', fechaLimite: null },
        { estado: 'HECHA', fechaLimite: null },
        { estado: 'PENDIENTE', fechaLimite: new Date('2026-11-01T00:00:00.000Z') }, // vencida
        { estado: 'EN_CURSO', fechaLimite: null },
      ]);
      const resp = await service.progreso('proy-1', 'user-1');
      expect(resp).toEqual({
        total: 4,
        hechas: 2,
        pendientes: 1,
        enCurso: 1,
        vencidas: 1,
        progreso: 50,
      });
    });

    it('total = 0 → progreso 0 sin dividir entre cero', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto());
      proyectos.tareasContables.mockResolvedValue([]);
      const resp = await service.progreso('proy-1', 'user-1');
      expect(resp.progreso).toBe(0);
      expect(resp.total).toBe(0);
    });
  });
});
