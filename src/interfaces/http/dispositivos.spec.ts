import { ConflictException, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { createHash } from 'crypto';
import { DispositivosService } from '../../aplicacion/dispositivos/dispositivos.service';
import { DISPOSITIVO_REPOSITORY, type DispositivoPublico, type DispositivoRepository, type PlataformaPush } from '../../dominio/puertos/dispositivo.repository';
import { USUARIO_REPOSITORY } from '../../dominio/puertos/usuario.repository';
import { DispositivosController } from './dispositivos.controller';
import { HttpExceptionFilter } from './http-exception.filter';
import { JwtStrategy } from './jwt.strategy';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const secretoToken = 'token-privado-de-prueba';
const codigoPrueba = 'K7Q2XM9B';

// Doble de puerto con estado: comprueba integración HTTP, NO locks/concurrencia SQL.
class MemoriaDispositivos implements DispositivoRepository {
  filas = new Map<string, { publico: DispositivoPublico; usuario: string; token: string; version: number; hash?: string; expira?: number }>();
  versiones = new Map([['u1', 0], ['u2', 2]]);
  async registrar(usuario: string, token: string, plataforma: PlataformaPush) {
    let fila = [...this.filas.values()].find(f => f.token === token);
    if (fila && fila.usuario !== usuario) throw new ConflictException('No se pudo registrar el dispositivo');
    const creado = !fila;
    if (!fila) {
      const id = `d${this.filas.size + 1}`;
      fila = { publico: { id, plataforma, creadoEn: new Date(), actualizadoEn: new Date(), ultimoEnvioEn: null }, usuario, token, version: 0 };
      this.filas.set(id, fila);
    }
    fila.version = this.versiones.get(usuario)!;
    fila.publico.plataforma = plataforma;
    return { dispositivo: fila.publico, creado };
  }
  async listar(usuario: string, page: number, pageSize: number) {
    const todas = [...this.filas.values()].filter(f => f.usuario === usuario).map(f => f.publico);
    return { datos: todas.slice((page - 1) * pageSize, page * pageSize), total: todas.length };
  }
  async revocar(usuario: string, id: string) {
    return this.filas.get(id)?.usuario === usuario ? this.filas.delete(id) : false;
  }
  async emitirCodigo(usuario: string, id: string) {
    const f = this.filas.get(id);
    if (!f || f.usuario !== usuario) return null;
    f.hash = digest(codigoPrueba); f.expira = Date.now() + 300_000;
    return { codigo: codigoPrueba, expiraEn: new Date(f.expira) };
  }
  async transferir(usuario: string, codigo: string, token: string) {
    const f = [...this.filas.values()].find(f => f.token === token && f.hash === digest(codigo) && f.expira! > Date.now());
    if (!f) return null;
    f.usuario = usuario; f.version = this.versiones.get(usuario)!; delete f.hash; delete f.expira;
    return f.publico;
  }
}

describe('RF20 API dispositivos (JWT/throttle reales, puerto en memoria)', () => {
  let app: INestApplication;
  let repo: MemoriaDispositivos;
  const jwt = new JwtService({ secret: 'solo-pruebas-locales' });
  const bearer = (id = 'u1', version = id === 'u1' ? 0 : 2) => `Bearer ${jwt.sign({ sub: id, tokenVersion: version })}`;
  const post = (path = '', id = 'u1') => request(app.getHttpServer()).post(`/api/v1/dispositivos${path}`).set('Authorization', bearer(id));
  const registrar = () => post().send({ token: secretoToken, plataforma: 'IOS' });
  beforeEach(async () => {
    repo = new MemoriaDispositivos();
    const modulo = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])],
      controllers: [DispositivosController],
      providers: [DispositivosService, JwtStrategy,
        { provide: DISPOSITIVO_REPOSITORY, useValue: repo },
        { provide: ConfigService, useValue: { get: () => 'solo-pruebas-locales' } },
        { provide: USUARIO_REPOSITORY, useValue: { buscarPorId: async (id: string) => repo.versiones.has(id) ? { id, tokenVersion: repo.versiones.get(id), email: 'test@example.test', nombre: 'Prueba' } : null } },
        { provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterEach(async () => { await app.close(); });

  it('registro repetido 201/200, refresca vínculo y no expone material privado', async () => {
    const primero = await registrar().expect(201);
    repo.versiones.set('u1', 1);
    const segundo = await post().set('Authorization', bearer('u1', 1)).send({ token: secretoToken, plataforma: 'ANDROID' }).expect(200);
    expect(segundo.body.id).toBe(primero.body.id);
    expect(repo.filas.size).toBe(1);
    expect(repo.filas.get(primero.body.id)?.version).toBe(1);
    expect(Object.keys(segundo.body).sort()).toEqual(['actualizadoEn', 'creadoEn', 'id', 'plataforma', 'ultimoEnvioEn']);
    expect(JSON.stringify(segundo.body)).not.toContain(secretoToken);
  });

  it.each(['', '/transferencia', '/d1/codigo-transferencia'])('POST %s requiere autenticación', async path => {
    await request(app.getHttpServer()).post(`/api/v1/dispositivos${path}`).send({}).expect(401);
  });
  it.each(['GET', 'DELETE'])('%s requiere JWT vigente', async method => {
    const url = `/api/v1/dispositivos${method === 'DELETE' ? '/d1' : ''}`;
    for (const auth of [undefined, 'Bearer invalido', bearer('u1', 99), bearer('inexistente'), `Bearer ${jwt.sign({ sub: 'u1', tokenVersion: 0 }, { expiresIn: -1 })}`]) {
      const req = method === 'GET' ? request(app.getHttpServer()).get(url) : request(app.getHttpServer()).delete(url);
      if (auth) req.set('Authorization', auth);
      await req.expect(401);
    }
  });

  it.each([
    {}, { token: '   ', plataforma: 'IOS' }, { token: 'x'.repeat(513), plataforma: 'IOS' },
    { token: 123, plataforma: 'IOS' }, { token: 't', plataforma: 'WEB' },
    { token: 't', plataforma: 'IOS', usuarioId: 'u2' },
  ])('rechaza DTO de registro inválido %#', async body => { await post().send(body).expect(400); expect(repo.filas.size).toBe(0); });

  it('conflicto ajeno genérico, listado aislado/paginado y revocación propia', async () => {
    const { body } = await registrar().expect(201);
    const conflicto = await post('', 'u2').send({ token: secretoToken, plataforma: 'IOS' }).expect(409);
    expect(conflicto.body).toEqual({ statusCode: 409, message: 'No se pudo registrar el dispositivo', error: 'Conflict' });
    const lista = await request(app.getHttpServer()).get('/api/v1/dispositivos?page=1&pageSize=1').set('Authorization', bearer()).expect(200);
    expect(lista.body.meta).toEqual({ pagina: 1, tamanoPagina: 1, total: 1, totalPaginas: 1 });
    expect(JSON.stringify(lista.body)).not.toMatch(/token|codigo|usuarioId/);
    const ajena = await request(app.getHttpServer()).get('/api/v1/dispositivos').set('Authorization', bearer('u2')).expect(200);
    expect(ajena.body.datos).toEqual([]);
    for (const id of [body.id, 'inexistente']) {
      await request(app.getHttpServer()).delete(`/api/v1/dispositivos/${id}`).set('Authorization', bearer('u2')).expect(404);
      await post(`/${id}/codigo-transferencia`, 'u2').expect(404);
    }
    await request(app.getHttpServer()).delete(`/api/v1/dispositivos/${body.id}`).set('Authorization', bearer()).expect(204, '');
    await request(app.getHttpServer()).delete(`/api/v1/dispositivos/${body.id}`).set('Authorization', bearer()).expect(404);
  });

  it.each(['page=0', 'page=x', 'pageSize=101', 'pageSize=0', 'usuarioId=u2'])('rechaza query %s', async query => {
    await request(app.getHttpServer()).get(`/api/v1/dispositivos?${query}`).set('Authorization', bearer()).expect(400);
  });

  it('paso1 rechaza campos, devuelve código solo por canal autorizado y TTL', async () => {
    const { body } = await registrar();
    await post(`/${body.id}/codigo-transferencia`).send({ usuarioId: 'u2' }).expect(400);
    const inicio = Date.now();
    const codigo = await post(`/${body.id}/codigo-transferencia`).expect(201);
    expect(Object.keys(codigo.body).sort()).toEqual(['codigo', 'expiraEn']);
    expect(codigo.body.codigo).toMatch(/^[A-Z2-9]{8}$/);
    expect(new Date(codigo.body.expiraEn).getTime() - inicio).toBeGreaterThanOrEqual(299_000);
    expect(JSON.stringify(codigo.body)).not.toContain(secretoToken);
  });

  it('transferencia simultánea tiene un ganador en el doble; cambia dueño/vínculo y bloquea reuso', async () => {
    const { body } = await registrar();
    await post(`/${body.id}/codigo-transferencia`).expect(201);
    const respuestas = await Promise.all([1, 2].map(() => post('/transferencia', 'u2').send({ codigo: codigoPrueba, token: secretoToken })));
    expect(respuestas.map(r => r.status).sort()).toEqual([200, 400]);
    expect(repo.filas.get(body.id)).toMatchObject({ usuario: 'u2', version: 2 });
    expect(repo.filas.get(body.id)?.hash).toBeUndefined();
    expect(JSON.stringify(respuestas.map(r => r.body))).not.toContain(secretoToken);
    await post(`/${body.id}/codigo-transferencia`).expect(404);
    const lista = await request(app.getHttpServer()).get('/api/v1/dispositivos').set('Authorization', bearer()).expect(200);
    expect(lista.body.datos).toEqual([]);
    await post().send({ token: secretoToken, plataforma: 'IOS' }).expect(409);
  });

  it.each(['expirado', 'incorrecto', 'token incorrecto', 'revocado'])('transferencia %s produce mismo error sin exposición', async caso => {
    const { body } = await registrar();
    await post(`/${body.id}/codigo-transferencia`);
    if (caso === 'expirado') repo.filas.get(body.id)!.expira = Date.now() - 1;
    if (caso === 'revocado') await request(app.getHttpServer()).delete(`/api/v1/dispositivos/${body.id}`).set('Authorization', bearer()).expect(204);
    const respuesta = await post('/transferencia', 'u2').send({ codigo: caso === 'incorrecto' ? 'AAAAAAAA' : codigoPrueba, token: caso === 'token incorrecto' ? 'otro' : secretoToken }).expect(400);
    expect(respuesta.body).toEqual({ statusCode: 400, message: 'La transferencia no es válida o ha caducado', error: 'Bad Request' });
    expect(JSON.stringify(respuesta.body)).not.toMatch(new RegExp(`${secretoToken}|${codigoPrueba}`));
  });

  it.each([{ codigo: codigoPrueba }, { token: secretoToken }, { codigo: 123, token: secretoToken }, { codigo: codigoPrueba, token: secretoToken, usuarioId: 'u1' }])('DTO transferencia inválido %#', async body => {
    await post('/transferencia', 'u2').send(body).expect(400);
  });

  it.each(['', 'incorrecto', 'A'.repeat(1000)])('código mal formado %# conserva error genérico', async codigo => {
    const res = await post('/transferencia', 'u2').send({ codigo, token: secretoToken }).expect(400);
    expect(res.body.message).toBe('La transferencia no es válida o ha caducado');
  });

  it('flujo completo no registra tokens ni códigos en Logger/consola', async () => {
    const spies = [jest.spyOn(Logger.prototype, 'log'), jest.spyOn(Logger.prototype, 'error'), jest.spyOn(Logger.prototype, 'warn'), jest.spyOn(Logger.prototype, 'debug'), jest.spyOn(Logger.prototype, 'verbose'), jest.spyOn(console, 'log'), jest.spyOn(console, 'error'), jest.spyOn(console, 'warn')];
    try {
      const { body } = await registrar().expect(201);
      await post(`/${body.id}/codigo-transferencia`).expect(201);
      await post('/transferencia', 'u2').send({ codigo: codigoPrueba, token: secretoToken }).expect(200);
      await post('/transferencia', 'u2').send({ codigo: codigoPrueba, token: secretoToken }).expect(400);
      expect(JSON.stringify(spies.map(s => s.mock.calls))).not.toMatch(new RegExp(`${secretoToken}|${codigoPrueba}`));
    } finally { spies.forEach(s => s.mockRestore()); }
  });

  it.each([['', 10], ['/d1/codigo-transferencia', 5], ['/transferencia', 5]] as const)('throttle %s límite %s por IP', async (path, limite) => {
    for (let i = 0; i < limite; i++) {
      const res = await post(path).send(path ? {} : { token: secretoToken, plataforma: 'IOS' });
      expect(res.status).not.toBe(429);
    }
    const res = await post(path).send({}).expect(429);
    expect(res.body.statusCode).toBe(429);
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${secretoToken}|${codigoPrueba}`));
  });
});
