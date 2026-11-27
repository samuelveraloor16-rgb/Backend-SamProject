import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TareasService } from '../../aplicacion/tareas/tareas.service';
import { USUARIO_REPOSITORY } from '../../dominio/puertos/usuario.repository';
import { TareasController } from './tareas.controller';
import { JwtStrategy } from './jwt.strategy';
import { HttpExceptionFilter } from './http-exception.filter';

describe('RF14/RF22 PATCH /tareas/:id/estado — wire HTTP sin AppModule/BD', () => {
  let app: INestApplication;
  let cambiarEstado: jest.Mock;
  const jwt = new JwtService({ secret: 'solo-pruebas-rf22-historial' });
  const token = (id = 'u1', version = 0) =>
    `Bearer ${jwt.sign({ sub: id, tokenVersion: version })}`;
  const url = '/api/v1/tareas/t1/estado';

  const tarea = {
    id: 't1',
    titulo: 'Tarea',
    descripcion: null,
    estado: 'HECHA',
    prioridad: 'MEDIA',
    fechaLimite: null,
    fechaFinalizacion: new Date('2026-11-26T12:00:00.000Z'),
    proyectoId: 'p1',
    responsable: null,
    tareaPadreId: null,
    etiquetas: [],
    vencida: false,
    subtareas: 0,
    creadoEn: new Date('2026-11-01T00:00:00.000Z'),
    actualizadoEn: new Date('2026-11-26T12:00:00.000Z'),
  };

  beforeEach(async () => {
    cambiarEstado = jest.fn().mockResolvedValue(tarea);
    const modulo = await Test.createTestingModule({
      controllers: [TareasController],
      providers: [
        JwtStrategy,
        { provide: TareasService, useValue: { cambiarEstado } },
        { provide: ConfigService, useValue: { get: () => 'solo-pruebas-rf22-historial' } },
        {
          provide: USUARIO_REPOSITORY,
          useValue: {
            buscarPorId: async (id: string) =>
              id === 'u1' ? { id, tokenVersion: 0 } : null,
          },
        },
      ],
    }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('200 conserva el shape Tarea y delega estado/usuario del JWT', async () => {
    const r = await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', token())
      .send({ estado: 'HECHA' })
      .expect(200);
    expect(cambiarEstado).toHaveBeenCalledWith('t1', 'u1', { estado: 'HECHA' });
    expect(r.body).toEqual({
      ...tarea,
      fechaFinalizacion: '2026-11-26T12:00:00.000Z',
      creadoEn: '2026-11-01T00:00:00.000Z',
      actualizadoEn: '2026-11-26T12:00:00.000Z',
    });
  });

  it('400 por estado inválido o campos ajenos, sin invocar al servicio', async () => {
    await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', token())
      .send({ estado: 'VENCIDA' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', token())
      .send({ estado: 'HECHA', usuarioId: 'otro' })
      .expect(400);
    expect(cambiarEstado).not.toHaveBeenCalled();
  });

  it('401 sin JWT y 404 genérico del servicio sin cambios', async () => {
    await request(app.getHttpServer()).patch(url).send({ estado: 'HECHA' }).expect(401);
    cambiarEstado.mockRejectedValueOnce(new NotFoundException('Tarea no encontrada'));
    const r = await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', token())
      .send({ estado: 'EN_CURSO' })
      .expect(404);
    expect(r.body).toEqual({
      statusCode: 404,
      message: 'Tarea no encontrada',
      error: 'Not Found',
    });
  });
});
