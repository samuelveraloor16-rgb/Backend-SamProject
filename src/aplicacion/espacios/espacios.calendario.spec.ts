import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EspaciosService } from './espacios.service';
import {
  ESPACIO_REPOSITORY,
  type EspacioRepository,
  type MembresiaEntity,
} from '../../dominio/puertos/espacio.repository';
import {
  TAREA_REPOSITORY,
  type TareaRepository,
  type TareaCompleta,
} from '../../dominio/puertos/tarea.repository';
import {
  USUARIO_REPOSITORY,
  type UsuarioRepository,
} from '../../dominio/puertos/usuario.repository';
import { MAILER, type Mailer } from '../../dominio/puertos/mailer.port';
import {
  parseFechaCalendario,
  resolverRangoCalendario,
} from '../comun/calendario-rango';
import { construirWhereCalendario } from '../../infraestructura/repositorios/prisma-tarea.repository';

function tarea(parcial: Partial<TareaCompleta> = {}): TareaCompleta {
  return {
    id: 'tar-1',
    titulo: 'Redactar notas',
    descripcion: null,
    estado: 'PENDIENTE',
    prioridad: 'MEDIA',
    fechaLimite: new Date('2026-12-05T00:00:00.000Z'),
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

const QUERY_BASE = { page: 1, pageSize: 20 };

describe('EspaciosService.calendario (RF-18)', () => {
  let service: EspaciosService;
  let espacios: jest.Mocked<EspacioRepository>;
  let tareas: jest.Mocked<TareaRepository>;

  beforeEach(async () => {
    espacios = {
      listarDeUsuario: jest.fn(),
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
    tareas = {
      listarCalendario: jest.fn().mockResolvedValue([]),
      listar: jest.fn(),
      buscarPorId: jest.fn(),
      listarSubtareas: jest.fn(),
      crear: jest.fn(),
      crearSubtareaAutorizada: jest.fn(),
      actualizar: jest.fn(),
      cambiarEstado: jest.fn(),
      eliminar: jest.fn(),
      moverConSubtareas: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EspaciosService,
        { provide: ESPACIO_REPOSITORY, useValue: espacios },
        { provide: TAREA_REPOSITORY, useValue: tareas },
        { provide: USUARIO_REPOSITORY, useValue: {} as jest.Mocked<UsuarioRepository> },
        { provide: MAILER, useValue: { enviar: jest.fn() } as jest.Mocked<Mailer> },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    service = moduleRef.get(EspaciosService);
  });

  it('criterio de ruta/params: propaga desde/hasta (fin del día UTC) al repositorio y los refleja en meta', async () => {
    tareas.listarCalendario.mockResolvedValue([
      tarea({ id: 'a', fechaLimite: new Date('2026-12-10T00:00:00.000Z') }),
      tarea({ id: 'b', fechaLimite: new Date('2026-12-02T00:00:00.000Z') }),
    ]);

    const resp = await service.calendario('esp-1', 'user-1', {
      ...QUERY_BASE,
      desde: '2026-12-01',
      hasta: '2026-12-31',
    });

    expect(tareas.listarCalendario).toHaveBeenCalledWith('esp-1', {
      desde: new Date('2026-12-01T00:00:00.000Z'),
      hasta: new Date('2026-12-31T23:59:59.999Z'),
    });
    expect(resp.meta.desde).toBe('2026-12-01');
    expect(resp.meta.hasta).toBe('2026-12-31');
    expect(resp.meta.totalDePorTareas).toBe(2);
    // TareaPublica estándar: orden fechaLimite asc, sin progreso de padre, vencida booleana
    expect(resp.datos.map((t) => t.id)).toEqual(['b', 'a']);
    expect(resp.datos[0]).toHaveProperty('vencida');
    expect(resp.datos[0]).toHaveProperty('subtareas');
  });

  it('filtros por defecto: sin params usa una ventana de 90 días desde hoy', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-19T10:00:00.000Z'));
    try {
      await service.calendario('esp-1', 'user-1', { ...QUERY_BASE });
      expect(tareas.listarCalendario).toHaveBeenCalledWith('esp-1', {
        desde: new Date('2026-11-19T00:00:00.000Z'),
        hasta: new Date('2027-02-17T23:59:59.999Z'), // hoy + 90 días
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('permisos: usuario no miembro del espacio → 404 y el repositorio no se llama', async () => {
    espacios.obtenerMembresia.mockResolvedValue(null);

    await expect(
      service.calendario('esp-ajeno', 'user-1', { ...QUERY_BASE }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tareas.listarCalendario).not.toHaveBeenCalled();
  });

  it('no retorna subtareas ni tareas de proyectos archivados (WHERE de Prisma)', () => {
    const where = construirWhereCalendario('esp-1', {
      desde: new Date('2026-12-01T00:00:00.000Z'),
      hasta: new Date('2026-12-31T23:59:59.999Z'),
    });
    expect(where).toEqual({
      tareaPadreId: null,
      proyecto: { espacioId: 'esp-1', archivado: false },
      fechaLimite: {
        gte: new Date('2026-12-01T00:00:00.000Z'),
        lte: new Date('2026-12-31T23:59:59.999Z'),
      },
    });

    // Ambos extremos `null` → sin límite de fechas, pero sigue exigiendo fechaLimite presente.
    const abierto = construirWhereCalendario('esp-1', { desde: null, hasta: null });
    expect(abierto).toEqual({
      tareaPadreId: null,
      proyecto: { espacioId: 'esp-1', archivado: false },
      fechaLimite: { not: null },
    });
  });

  it('meta incluye totalDePorTareas y pagina en envelope (pageSize honrado)', async () => {
    const filas = Array.from({ length: 25 }, (_, i) =>
      tarea({ id: `tar-${i}`, fechaLimite: new Date(`2026-12-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`) }),
    );
    tareas.listarCalendario.mockResolvedValue(filas);

    const resp = await service.calendario('esp-1', 'user-1', {
      page: 1,
      pageSize: 20,
      desde: '2026-12-01',
      hasta: '2026-12-31',
    });

    expect(resp.datos).toHaveLength(20);
    expect(resp.meta.total).toBe(25);
    expect(resp.meta.totalPaginas).toBe(2);
    expect(resp.meta.totalDePorTareas).toBe(25);
  });

  it('literal null en un extremo abre ese lado (y el otro si se omitió)', async () => {
    await service.calendario('esp-1', 'user-1', {
      ...QUERY_BASE,
      desde: 'null', // sin límite inferior; hasta omitido y desde abierto → todo el futuro
    });
    expect(tareas.listarCalendario).toHaveBeenCalledWith('esp-1', {
      desde: null,
      hasta: null,
    });
  });

  it('hasta anterior a desde → 400', async () => {
    await expect(
      service.calendario('esp-1', 'user-1', {
        ...QUERY_BASE,
        desde: '2026-12-31',
        hasta: '2026-12-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fecha imposible (2026-02-31) → 400', async () => {
    await expect(
      service.calendario('esp-1', 'user-1', {
        ...QUERY_BASE,
        desde: '2026-02-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('resolverRangoCalendario / parseFechaCalendario (RF-18)', () => {
  it('parseFechaCalendario acepta fechas reales y rechaza imposibles', () => {
    expect(parseFechaCalendario('2026-02-28')).not.toBeNull();
    expect(parseFechaCalendario('2026-02-31')).toBeNull();
    expect(parseFechaCalendario('19/11/2026')).toBeNull();
  });

  it('un solo extremo deriva el otro para completar 90 días', () => {
    const soloDesde = resolverRangoCalendario('2026-12-01', undefined);
    expect(soloDesde.desdeStr).toBe('2026-12-01');
    expect(soloDesde.hastaStr).toBe('2027-03-01'); // 2026-12-01 + 90 días

    const soloHasta = resolverRangoCalendario(undefined, '2026-12-31');
    expect(soloHasta.hastaStr).toBe('2026-12-31');
    expect(soloHasta.desdeStr).toBe('2026-10-02'); // 2026-12-31 − 90 días
  });
});
