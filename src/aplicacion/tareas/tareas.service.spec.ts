import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TareasService, ordenarTareas } from './tareas.service';
import {
  TAREA_REPOSITORY,
  type TareaRepository,
  type TareaCompleta,
} from '../../dominio/puertos/tarea.repository';
import {
  ETIQUETA_REPOSITORY,
  type EtiquetaRepository,
} from '../../dominio/puertos/etiqueta.repository';
import {
  PROYECTO_REPOSITORY,
  type ProyectoRepository,
  type ProyectoConMiembros,
} from '../../dominio/puertos/proyecto.repository';
import {
  ESPACIO_REPOSITORY,
  type EspacioRepository,
  type MembresiaEntity,
  type EspacioEntity,
} from '../../dominio/puertos/espacio.repository';

function tarea(parcial: Partial<TareaCompleta> = {}): TareaCompleta {
  return {
    id: 'tar-1',
    titulo: 'Redactar notas',
    descripcion: null,
    estado: 'PENDIENTE',
    prioridad: 'MEDIA',
    fechaLimite: null,
    fechaFinalizacion: null,
    proyectoId: 'proy-1',
    responsableId: null,
    tareaPadreId: null,
    creadoEn: new Date('2026-11-10T00:00:00.000Z'),
    actualizadoEn: new Date('2026-11-10T00:00:00.000Z'),
    responsable: null,
    etiquetas: [],
    totalSubtareas: 0,
    ...parcial,
  };
}

function proyecto(parcial: Partial<ProyectoConMiembros> = {}): ProyectoConMiembros {
  return {
    id: 'proy-1',
    nombre: 'Lanzamiento',
    descripcion: null,
    fechaInicio: null,
    fechaFin: null,
    archivado: false,
    esBandejaDeEntrada: false,
    espacioId: 'esp-1',
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
    actualizadoEn: new Date('2026-11-01T00:00:00.000Z'),
    eliminadoEn: null,
    miembros: [],
    ...parcial,
  };
}

function membresia(parcial: Partial<MembresiaEntity> = {}): MembresiaEntity {
  return {
    id: 'mem-1',
    usuarioId: 'user-1',
    espacioId: 'esp-1',
    rol: 'MIEMBRO',
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
    ...parcial,
  };
}

function espacioPersonal(): { espacio: EspacioEntity; miRol: 'ADMINISTRADOR'; totalMiembros: number } {
  return {
    espacio: {
      id: 'esp-personal',
      nombre: 'Espacio de Ana',
      esPersonal: true,
      asistenteActivo: true,
      creadoEn: new Date('2026-01-01T00:00:00.000Z'),
      actualizadoEn: new Date('2026-01-01T00:00:00.000Z'),
    },
    miRol: 'ADMINISTRADOR',
    totalMiembros: 1,
  };
}

const FILTROS_BASE = { page: 1, pageSize: 20, orden: 'creadoEn' as const, archivados: undefined };

describe('TareasService', () => {
  let service: TareasService;
  let tareas: jest.Mocked<TareaRepository>;
  let etiquetas: jest.Mocked<EtiquetaRepository>;
  let proyectos: jest.Mocked<ProyectoRepository>;
  let espacios: jest.Mocked<EspacioRepository>;

  beforeEach(async () => {
    tareas = {
      listarCalendario: jest.fn().mockResolvedValue([]),
      listar: jest.fn().mockResolvedValue([]),
      buscarPorId: jest.fn(),
      listarSubtareas: jest.fn().mockResolvedValue([]),
      crear: jest.fn(),
      crearSubtareaAutorizada: jest.fn(),
      actualizar: jest.fn(),
      eliminar: jest.fn(),
      moverConSubtareas: jest.fn().mockResolvedValue(tarea()),
    };
    etiquetas = {
      listarPorEspacio: jest.fn(),
      crear: jest.fn(),
      buscarPorIdsEnEspacio: jest.fn().mockResolvedValue([]),
      existeNombreEnEspacio: jest.fn(),
    };
    proyectos = {
      listarPorEspacio: jest.fn(),
      actualizarAutorizado: jest.fn(),
      buscarPorId: jest.fn().mockResolvedValue(proyecto()),
      filtrarIdsMiembrosDelEspacio: jest.fn().mockResolvedValue([]),
      crear: jest.fn(),
      actualizar: jest.fn(),
      reemplazarMiembros: jest.fn(),
      eliminar: jest.fn(),
      obtenerBandeja: jest.fn(),
      tareasContables: jest.fn().mockResolvedValue([]),
    };
    espacios = {
      listarDeUsuario: jest.fn().mockResolvedValue([espacioPersonal()]),
      buscarPorId: jest.fn(),
      obtenerMembresia: jest.fn().mockResolvedValue(membresia()),
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        TareasService,
        { provide: TAREA_REPOSITORY, useValue: tareas },
        { provide: ETIQUETA_REPOSITORY, useValue: etiquetas },
        { provide: PROYECTO_REPOSITORY, useValue: proyectos },
        { provide: ESPACIO_REPOSITORY, useValue: espacios },
      ],
    }).compile();

    service = moduleRef.get(TareasService);
  });

  describe('listarPorProyecto (RF-16)', () => {
    it('pasa filtros al repo y pagina el envelope', async () => {
      tareas.listar.mockResolvedValue([tarea(), tarea({ id: 'tar-2' })]);
      const resp = await service.listarPorProyecto('proy-1', 'user-1', {
        ...FILTROS_BASE,
        estado: 'PENDIENTE',
        q: ' notas ',
      });
      expect(tareas.listar).toHaveBeenCalledWith(
        'proy-1',
        expect.objectContaining({ estado: 'PENDIENTE', q: 'notas' }),
      );
      expect(resp.meta.total).toBe(2);
      expect(resp.datos).toHaveLength(2);
    });

    it('404 si el proyecto es ajeno', async () => {
      proyectos.buscarPorId.mockResolvedValue(null);
      await expect(
        service.listarPorProyecto('proy-x', 'user-1', { ...FILTROS_BASE }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('crear (RF-12)', () => {
    it('crea con prioridad MEDIA por defecto', async () => {
      tareas.crear.mockImplementation(async (datos) => tarea({ ...datos, id: 'tar-9' }) as TareaCompleta);
      const resp = await service.crear('proy-1', 'user-1', { titulo: 'Nueva tarea' });
      expect(tareas.crear).toHaveBeenCalledWith(
        expect.objectContaining({ prioridad: 'MEDIA', titulo: 'Nueva tarea', proyectoId: 'proy-1' }),
      );
      expect(resp.id).toBe('tar-9');
    });

    it('400 si el proyecto está archivado', async () => {
      proyectos.buscarPorId.mockResolvedValue(proyecto({ archivado: true }));
      await expect(
        service.crear('proy-1', 'user-1', { titulo: 'X' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tareas.crear).not.toHaveBeenCalled();
    });

    it('400 si el responsable no es miembro del espacio', async () => {
      proyectos.filtrarIdsMiembrosDelEspacio.mockResolvedValue([]); // no encontrado
      await expect(
        service.crear('proy-1', 'user-1', { titulo: 'X', responsableId: 'user-9' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si alguna etiqueta es de otro espacio', async () => {
      proyectos.filtrarIdsMiembrosDelEspacio.mockResolvedValue(['user-1']);
      etiquetas.buscarPorIdsEnEspacio.mockResolvedValue([]); // ninguna del espacio
      await expect(
        service.crear('proy-1', 'user-1', { titulo: 'X', etiquetas: ['et-ajena'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('obtener (RF-12)', () => {
    it('expone vencida como booleano calculado (RF-15)', async () => {
      const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
      tareas.buscarPorId.mockResolvedValue(tarea({ fechaLimite: ayer, estado: 'PENDIENTE' }));
      const resp = await service.obtener('tar-1', 'user-1');
      expect(resp.vencida).toBe(true);
      expect(resp).toHaveProperty('subtareasDetalle');
    });

    it('una tarea HECHA con fecha pasada NO está vencida', async () => {
      const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
      tareas.buscarPorId.mockResolvedValue(tarea({ fechaLimite: ayer, estado: 'HECHA' }));
      const resp = await service.obtener('tar-1', 'user-1');
      expect(resp.vencida).toBe(false);
    });
  });

  describe('actualizar (RF-12)', () => {
    it('400 si no hay campos', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea());
      await expect(service.actualizar('tar-1', 'user-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('fechaLimite: null limpia la fecha', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ fechaLimite: new Date() }));
      tareas.actualizar.mockImplementation(async (_id, datos) => tarea({ ...datos } as Partial<TareaCompleta>));
      await service.actualizar('tar-1', 'user-1', { fechaLimite: null });
      expect(tareas.actualizar).toHaveBeenCalledWith(
        'tar-1',
        expect.objectContaining({ fechaLimite: null }),
      );
    });

    it('responsableId: null desasigna sin validar contra el espacio', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ responsableId: 'user-1' }));
      tareas.actualizar.mockImplementation(async (_id, datos) => tarea({ ...datos } as Partial<TareaCompleta>));
      await service.actualizar('tar-1', 'user-1', { responsableId: null });
      expect(proyectos.filtrarIdsMiembrosDelEspacio).not.toHaveBeenCalled();
      expect(tareas.actualizar).toHaveBeenCalledWith(
        'tar-1',
        expect.objectContaining({ responsableId: null }),
      );
    });

    it('400 si el proyecto está archivado', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea());
      proyectos.buscarPorId.mockResolvedValue(proyecto({ archivado: true }));
      await expect(
        service.actualizar('tar-1', 'user-1', { titulo: 'Otro' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('crearSubtarea (RF-12)', () => {
    it('400 si la tarea padre ya es una subtarea (un solo nivel)', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ tareaPadreId: 'padre' }));
      await expect(
        service.crearSubtarea('tar-1', 'user-1', { titulo: 'Sub' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('la subtarea hereda proyectoId del padre', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ id: 'padre', proyectoId: 'proy-42' }));
      proyectos.buscarPorId.mockResolvedValue(proyecto({ id: 'proy-42' }));
      tareas.crearSubtareaAutorizada.mockImplementation(async (datos) => tarea({ ...datos, id: 'sub-1', tareaPadreId: 'padre' }) as TareaCompleta);
      const resp = await service.crearSubtarea('padre', 'user-1', { titulo: 'Sub tarea' });
      expect(tareas.crearSubtareaAutorizada).toHaveBeenCalledWith(
        expect.objectContaining({ proyectoId: 'proy-42', tareaPadreId: 'padre' }), 'user-1',
      );
      expect(resp.tareaPadreId).toBe('padre');
    });
  });

  describe('cambiarEstado (RF-14)', () => {
    it('→ HECHA establece fechaFinalizacion en el backend', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ estado: 'PENDIENTE' }));
      tareas.actualizar.mockImplementation(async (_id, datos) => tarea({ ...datos } as Partial<TareaCompleta>));
      const resp = await service.cambiarEstado('tar-1', 'user-1', { estado: 'HECHA' });
      expect(tareas.actualizar).toHaveBeenCalledWith(
        'tar-1',
        expect.objectContaining({ estado: 'HECHA', fechaFinalizacion: expect.any(Date) }),
      );
      expect(resp.estado).toBe('HECHA');
    });

    it('salir de HECHA limpia fechaFinalizacion', async () => {
      tareas.buscarPorId.mockResolvedValue(
        tarea({ estado: 'HECHA', fechaFinalizacion: new Date() }),
      );
      tareas.actualizar.mockImplementation(async (_id, datos) => tarea({ ...datos } as Partial<TareaCompleta>));
      await service.cambiarEstado('tar-1', 'user-1', { estado: 'EN_CURSO' });
      expect(tareas.actualizar).toHaveBeenCalledWith(
        'tar-1',
        expect.objectContaining({ estado: 'EN_CURSO', fechaFinalizacion: null }),
      );
    });

    it('transición DISPARADA: PENDIENTE → HECHA está permitida (orden de UI, no restricción)', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ estado: 'PENDIENTE' }));
      tareas.actualizar.mockImplementation(async (_id, datos) => tarea({ ...datos } as Partial<TareaCompleta>));
      await expect(
        service.cambiarEstado('tar-1', 'user-1', { estado: 'HECHA' }),
      ).resolves.toBeDefined();
    });

    it('400 si el proyecto está archivado', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea());
      proyectos.buscarPorId.mockResolvedValue(proyecto({ archivado: true }));
      await expect(
        service.cambiarEstado('tar-1', 'user-1', { estado: 'EN_CURSO' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('rapida (RF-13)', () => {
    const bandeja = proyecto({ id: 'proy-bandeja', esBandejaDeEntrada: true });

    it('sin espacioId usa la Bandeja del espacio personal, prioridad MEDIA, PENDIENTE', async () => {
      proyectos.obtenerBandeja.mockResolvedValue(bandeja);
      tareas.crear.mockImplementation(async (datos) => tarea({ ...datos, id: 'tar-rapida' }) as TareaCompleta);
      const resp = await service.rapida('user-1', { titulo: 'Comprar SSL' });
      expect(tareas.crear).toHaveBeenCalledWith(
        expect.objectContaining({
          proyectoId: 'proy-bandeja',
          prioridad: 'MEDIA',
          tareaPadreId: null,
        }),
      );
      expect(resp.prioridad).toBe('MEDIA');
      expect(resp.estado).toBe('PENDIENTE');
    });

    it('con espacioId ajeno → 404', async () => {
      espacios.obtenerMembresia.mockResolvedValue(null);
      await expect(
        service.rapida('user-1', { titulo: 'X', espacioId: 'esp-ajeno' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('con espacioId propio usa la Bandeja de ESE espacio', async () => {
      proyectos.obtenerBandeja.mockResolvedValue({ ...bandeja, espacioId: 'esp-equipo' });
      tareas.crear.mockImplementation(async (datos) => tarea({ ...datos }) as TareaCompleta);
      await service.rapida('user-1', { titulo: 'X', espacioId: 'esp-equipo' });
      expect(proyectos.obtenerBandeja).toHaveBeenCalledWith('esp-equipo');
    });
  });

  describe('mover (RF-13)', () => {
    it('no revela que es subtarea si no está autorizado', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ tareaPadreId: 'padre' }));
      espacios.obtenerMembresia.mockResolvedValue(null);
      await expect(service.mover('tar-1', 'user-x', { proyectoId: 'proy-2' })).rejects.toBeInstanceOf(NotFoundException);
      expect(tareas.moverConSubtareas).not.toHaveBeenCalled();
    });
    it('rechaza mover hija independientemente, pero permite no-op', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ tareaPadreId: 'padre' }));
      proyectos.buscarPorId.mockImplementation(async id => proyecto({ id }));
      await expect(service.mover('tar-1', 'user-1', { proyectoId: 'proy-2' })).rejects.toBeInstanceOf(BadRequestException);
      expect(tareas.moverConSubtareas).not.toHaveBeenCalled();
      await service.mover('tar-1', 'user-1', { proyectoId: 'proy-1' });
      expect(tareas.moverConSubtareas).toHaveBeenCalledWith('tar-1', 'proy-1', 'user-1');
    });
    it('400 entre espacios distintos', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ proyectoId: 'proy-1' }));
      proyectos.buscarPorId.mockImplementation(async (id: string) =>
        id === 'proy-1'
          ? proyecto({ id: 'proy-1', espacioId: 'esp-1' })
          : proyecto({ id: 'proy-2', espacioId: 'esp-2' }),
      );
      await expect(
        service.mover('tar-1', 'user-1', { proyectoId: 'proy-2' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si el destino está archivado', async () => {
      tareas.buscarPorId.mockResolvedValue(tarea({ proyectoId: 'proy-1' }));
      proyectos.buscarPorId.mockImplementation(async (id: string) =>
        id === 'proy-1'
          ? proyecto({ id: 'proy-1', espacioId: 'esp-1' })
          : proyecto({ id: 'proy-2', espacioId: 'esp-1', archivado: true }),
      );
      await expect(
        service.mover('tar-1', 'user-1', { proyectoId: 'proy-2' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('mueve la tarea y sus subtareas en el caso feliz', async () => {
      tareas.buscarPorId
        .mockResolvedValueOnce(tarea({ proyectoId: 'proy-1' })) // para validar origen
        .mockResolvedValueOnce(tarea({ proyectoId: 'proy-2' })); // re-fetch tras mover
      proyectos.buscarPorId.mockImplementation(async (id: string) =>
        proyecto({ id, espacioId: 'esp-1' }),
      );
      tareas.moverConSubtareas.mockResolvedValue(tarea({ proyectoId: 'proy-2' }));
      const resp = await service.mover('tar-1', 'user-1', { proyectoId: 'proy-2' });
      expect(tareas.moverConSubtareas).toHaveBeenCalledWith('tar-1', 'proy-2', 'user-1');
      expect(tareas.buscarPorId).toHaveBeenCalledTimes(1);
      expect(resp.proyectoId).toBe('proy-2');
    });
  });

  describe('listarBandeja (RF-13)', () => {
    it('incluye proyectoId en meta', async () => {
      proyectos.obtenerBandeja.mockResolvedValue(proyecto({ id: 'proy-bandeja', esBandejaDeEntrada: true }));
      const resp = await service.listarBandeja('esp-1', 'user-1', { ...FILTROS_BASE });
      expect(resp.meta).toEqual(
        expect.objectContaining({ proyectoId: 'proy-bandeja', total: 0 }),
      );
    });
  });
});

describe('ordenarTareas (RF-16)', () => {
  it('prioridad desc: URGENTE primero', () => {
    const filas = [
      tarea({ id: 'a', prioridad: 'BAJA' }),
      tarea({ id: 'b', prioridad: 'URGENTE' }),
      tarea({ id: 'c', prioridad: 'MEDIA' }),
    ];
    const ordenadas = ordenarTareas(filas, 'prioridad', 'desc');
    expect(ordenadas.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('fechaLimite asc con nulls al final', () => {
    const filas = [
      tarea({ id: 'sin-fecha', fechaLimite: null }),
      tarea({ id: 'tarde', fechaLimite: new Date('2026-12-31T00:00:00.000Z') }),
      tarea({ id: 'pronto', fechaLimite: new Date('2026-11-20T00:00:00.000Z') }),
    ];
    const ordenadas = ordenarTareas(filas, 'fechaLimite', 'asc');
    expect(ordenadas.map((t) => t.id)).toEqual(['pronto', 'tarde', 'sin-fecha']);
  });
});
