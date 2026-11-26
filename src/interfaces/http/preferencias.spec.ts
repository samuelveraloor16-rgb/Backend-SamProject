import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PreferenciasService } from '../../aplicacion/perfil/preferencias.service';
import { CambioPreferencia, matrizEfectiva, PREFERENCIAS_REPOSITORY, PreferenciaNotificacion, PreferenciasRepository } from '../../dominio/puertos/preferencias.repository';
import { USUARIO_REPOSITORY } from '../../dominio/puertos/usuario.repository';
import { PreferenciasController } from './preferencias.controller';
import { JwtStrategy } from './jwt.strategy';
import { HttpExceptionFilter } from './http-exception.filter';

// Doble de puerto: prueba contrato HTTP y aislamiento, NO persistencia PostgreSQL real.
class MemoriaPreferencias implements PreferenciasRepository {
  filas = new Map<string, PreferenciaNotificacion[]>();
  escrituras = 0;
  async listar(id: string) { return this.filas.get(id) ?? []; }
  async actualizar(id: string, cambios: CambioPreferencia[]) {
    this.escrituras++;
    const actuales = matrizEfectiva(await this.listar(id)).preferencias;
    const filas = actuales.map(f => ({ ...f, ...cambios.find(c => c.tipo === f.tipo) }));
    this.filas.set(id, filas);
    return filas;
  }
}

describe('RF21 preferencias HTTP (JWT real, persistencia simulada)', () => {
  let app: INestApplication;
  let repo: MemoriaPreferencias;
  const jwt = new JwtService({ secret: 'solo-pruebas-rf21' });
  const token = (id = 'u1', version = 0) => `Bearer ${jwt.sign({ sub: id, tokenVersion: version })}`;
  const url = '/api/v1/perfil/preferencias-notificaciones';
  const patch = (body: unknown, id = 'u1') => request(app.getHttpServer()).patch(url).set('Authorization', token(id)).send(body as object);
  const get = (id = 'u1') => request(app.getHttpServer()).get(url).set('Authorization', token(id));
  beforeEach(async () => {
    repo = new MemoriaPreferencias();
    const modulo = await Test.createTestingModule({
      controllers: [PreferenciasController],
      providers: [PreferenciasService, JwtStrategy,
        { provide: PREFERENCIAS_REPOSITORY, useValue: repo },
        { provide: ConfigService, useValue: { get: () => 'solo-pruebas-rf21' } },
        { provide: USUARIO_REPOSITORY, useValue: { buscarPorId: async (id: string) => ['u1', 'u2'].includes(id) ? { id, tokenVersion: 0 } : null } }],
    }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterEach(async () => { await app.close(); });

  it('defaults completos y GET repetido no escribe', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await get().expect(200);
      expect(r.body).toEqual(matrizEfectiva([]));
      expect(r.body.preferencias).toHaveLength(5);
      expect(r.body.preferencias.filter((f: PreferenciaNotificacion) => f.inApp).map((f: PreferenciaNotificacion) => f.tipo)).toEqual(['MENCION']);
    }
    expect(repo.escrituras).toBe(0);
    expect(repo.filas.size).toBe(0);
  });
  it('PATCH parcial, repetido, GET persistido y cambio de cuenta aislado sin roles', async () => {
    await patch({ preferencias: [{ tipo: 'COMENTARIO', correo: true }] }).expect(200);
    const cuerpo = { preferencias: [{ tipo: 'COMENTARIO', push: false }] };
    const r = await patch(cuerpo).expect(200);
    expect(r.body.preferencias[3]).toEqual({ tipo: 'COMENTARIO', correo: true, push: false, inApp: false });
    expect((await patch(cuerpo).expect(200)).body).toEqual(r.body);
    expect((await get().expect(200)).body).toEqual(r.body);
    expect((await get('u2').expect(200)).body).toEqual(matrizEfectiva([]));
    await patch({ preferencias: [{ tipo: 'MENCION', correo: true, inApp: true }] }, 'u2').expect(200);
    expect((await get().expect(200)).body).toEqual(r.body);
    expect(JSON.stringify(r.body)).not.toMatch(/usuarioId|u1|u2/);
  });
  const valid = { tipo: 'COMENTARIO', push: false };
  it.each([
    {}, [], { preferencias: null }, { preferencias: {} }, { preferencias: [] },
    { preferencias: Array(6).fill(valid) }, { preferencias: [valid, valid] },
    { preferencias: [null] }, { preferencias: [[]] }, { preferencias: [{}] },
    { preferencias: [{ tipo: 'COMENTARIO' }] },
    ...['INVITACION', 'SISTEMA', 'mencion', 1, null].map(tipo => ({ preferencias: [{ tipo, push: true }] })),
    ...['false', 0, null, [], {}].map(push => ({ preferencias: [{ tipo: 'COMENTARIO', push }] })),
    { preferencias: [valid], usuarioId: 'u2' },
    { preferencias: [{ ...valid, usuarioId: 'u2' }] },
    { preferencias: [{ ...valid, desconocida: true }] },
    { preferencias: [valid, { tipo: 'MENCION', inApp: false }] },
  ])('400 sin mutación parcial %#', async body => {
    await patch({ preferencias: [{ tipo: 'TAREA_ASIGNADA', correo: true }] }).expect(200);
    const anterior = JSON.stringify([...repo.filas]);
    await patch(body).expect(400);
    expect(JSON.stringify([...repo.filas])).toBe(anterior);
    expect(repo.escrituras).toBe(1);
  });
  it('null y primitivos JSON rechazados', async () => {
    for (const raw of ['null', 'false', '"texto"', '123']) {
      await request(app.getHttpServer()).patch(url).set('Authorization', token()).set('Content-Type', 'application/json').send(raw).expect(400);
    }
    expect(repo.escrituras).toBe(0);
  });
  it.each(['get', 'patch'] as const)('%s requiere JWT vigente y no acepta ID cliente', async method => {
    for (const auth of [undefined, 'Bearer malformado', token('u1', 9), token('inexistente'), `Bearer ${jwt.sign({ sub: 'u1', tokenVersion: 0 }, { expiresIn: -1 })}`]) {
      const req = request(app.getHttpServer())[method](url);
      if (auth) req.set('Authorization', auth);
      if (method === 'patch') req.send({ preferencias: [valid] });
      await req.expect(401);
    }
    const req = request(app.getHttpServer())[method](`${url}?usuarioId=u2`).set('Authorization', token());
    if (method === 'patch') req.send({ preferencias: [valid] });
    await req.expect(400);
    expect(repo.escrituras).toBe(0);
  });
  it('GET con body ajeno rechazado', async () => {
    await get().send({ usuarioId: 'u2' }).expect(400);
  });
});
