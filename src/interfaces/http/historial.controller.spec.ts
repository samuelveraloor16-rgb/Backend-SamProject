import { INestApplication, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HISTORIAL_REPOSITORY } from '../../dominio/puertos/historial.repository';
import { USUARIO_REPOSITORY } from '../../dominio/puertos/usuario.repository';
import { HistorialController } from './historial.controller';
import { JwtStrategy } from './jwt.strategy';
import { HttpExceptionFilter } from './http-exception.filter';

describe('historial wire JWT sin AppModule/BD/cron', () => {
  let app: INestApplication; let listar: jest.Mock;
  const secret = 'testkey-http-only';
  const jwt = new JwtService({ secret });
  const token = (id = 'u', version = 0) => `Bearer ${jwt.sign({ sub: id, tokenVersion: version })}`;
  beforeEach(async () => {
    listar = jest.fn().mockResolvedValue({ datos: [], meta: { limite: 20, siguienteCursor: null } });
    const modulo = await Test.createTestingModule({ controllers: [HistorialController], providers: [
      JwtStrategy,
      { provide: ConfigService, useValue: { get: () => secret } },
      { provide: HISTORIAL_REPOSITORY, useValue: { listar } },
      { provide: USUARIO_REPOSITORY, useValue: { buscarPorId: async (id: string) => id === 'u' ? { id, tokenVersion: 0 } : null } },
    ] }).compile();
    app = modulo.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter()); await app.init();
  });
  afterEach(async () => { await app.close(); });
  it.each(['proyectos', 'tareas'])('%s JWT ausente/inválido/revocado401 antes repositorio', async ruta => {
    for (const auth of ['', 'Bearer incorrecto', token('u', 1), token('ajeno')]) {
      await request(app.getHttpServer()).get(`/api/v1/${ruta}/id/historial`).set('Authorization', auth).expect(401);
    }
    expect(listar).not.toHaveBeenCalled();
  });
  it.each([['proyectos', 'PROYECTO'], ['tareas', 'TAREA']])('%s delega ruta y usuario exclusivamente JWT', async (ruta, tipo) => {
    const r = await request(app.getHttpServer()).get(`/api/v1/${ruta}/id/historial?limite=2&cursor=opaco`).set('Authorization', token()).expect(200);
    expect(listar).toHaveBeenCalledWith(tipo, 'id', 'u', { limite: '2', cursor: 'opaco' }, undefined);
    expect(r.body).toEqual({ datos: [], meta: { limite: 20, siguienteCursor: null } });
  });
  it('404 idéntico ajeno/inexistente/borrado del adaptador', async () => {
    listar.mockRejectedValue(new NotFoundException('Recurso no encontrado'));
    const respuestas = [];
    for (const id of ['ajeno', 'inexistente', 'borrado']) respuestas.push((await request(app.getHttpServer()).get(`/api/v1/tareas/${id}/historial`).set('Authorization', token()).expect(404)).body);
    expect(respuestas[0]).toEqual(respuestas[1]); expect(respuestas[1]).toEqual(respuestas[2]);
  });
});
