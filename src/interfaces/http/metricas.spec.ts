import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MetricasService } from '../../aplicacion/metricas/metricas.service';
import { METRICAS_REPOSITORY } from '../../dominio/puertos/metricas.repository';
import { USUARIO_REPOSITORY } from '../../dominio/puertos/usuario.repository';
import { MetricasController } from './metricas.controller';
import { JwtStrategy } from './jwt.strategy';
import { HttpExceptionFilter } from './http-exception.filter';

describe('RF22 HTTP offline con JWT real y puerto doble (sin AppModule/BD/scheduler)', () => {
  let app: INestApplication;
  let leer: jest.Mock;
  const jwt = new JwtService({ secret: 'solo-pruebas-rf22' });
  const token = (id = 'miembro', version = 0) => `Bearer ${jwt.sign({ sub: id, tokenVersion: version })}`;
  const url = '/api/v1/proyectos/p1/metricas';
  beforeEach(async () => {
    leer = jest.fn(async (id: string, usuario: string) => id === 'p1' && ['miembro', 'admin'].includes(usuario) ? { calculadoEn: new Date(), contables: [], historial: { desde: null, coberturaAcreditada: false, grupos: [] } } : null);
    const modulo = await Test.createTestingModule({
      controllers: [MetricasController],
      providers: [MetricasService, JwtStrategy,
        { provide: METRICAS_REPOSITORY, useValue: { leerInstantaneaVisible: leer } },
        { provide: ConfigService, useValue: { get: () => 'solo-pruebas-rf22' } },
        { provide: USUARIO_REPOSITORY, useValue: { buscarPorId: async (id: string) => ['miembro', 'admin', 'ajeno'].includes(id) ? { id, tokenVersion: 0 } : null } }],
    }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterEach(async () => { await app.close(); });

  it.each(['miembro', 'admin'])('200 bare %s con referencia backend y sin otros campos', async usuario => {
    const desde = Date.now();
    const r = await request(app.getHttpServer()).get(url).set('Authorization', token(usuario)).expect(200);
    expect(r.body).toEqual({ proyectoId: 'p1', calculadoEn: expect.any(String), total: 0, hechas: 0, pendientes: 0, enCurso: 0, vencidas: 0, progreso: 0, trabajoPendiente: 0, ritmo: { disponible: false, motivo: 'COBERTURA_NO_ACREDITADA' } });
    expect(Date.parse(r.body.calculadoEn)).toBeGreaterThanOrEqual(desde);
    expect(Date.parse(r.body.calculadoEn)).toBeLessThanOrEqual(Date.now());
    expect(leer).toHaveBeenCalledWith('p1', usuario);
  });
  it('401 JWT ausente/inválido/caducado/revocado/usuario inexistente sin consultar métricas', async () => {
    for (const auth of [undefined, 'Bearer malformado', token('miembro', 1), token('inexistente'), `Bearer ${jwt.sign({ sub: 'miembro', tokenVersion: 0 }, { expiresIn: -1 })}`]) {
      const req = request(app.getHttpServer()).get(url);
      if (auth) req.set('Authorization', auth);
      await req.expect(401);
    }
    expect(leer).not.toHaveBeenCalled();
  });
  it('404 ajeno e inexistente idénticos', async () => {
    const ajeno = await request(app.getHttpServer()).get(url).set('Authorization', token('ajeno')).expect(404);
    const inexistente = await request(app.getHttpServer()).get(url.replace('p1', 'no-existe')).set('Authorization', token()).expect(404);
    expect(ajeno.body).toEqual(inexistente.body);
    expect(ajeno.body).toEqual({ statusCode: 404, message: 'Proyecto no encontrado', error: 'Not Found' });
  });
  it.each(['page=1', 'estado=VENCIDA', 'usuarioId=admin', 'calculadoEn=2026-01-01', 'espacioId=e2', 'q=x&q=y'])('400 query desconocida %s', async query => {
    const r = await request(app.getHttpServer()).get(`${url}?${query}`).set('Authorization', token()).expect(400);
    expect(Array.isArray(r.body.message)).toBe(true);
    expect(leer).not.toHaveBeenCalled();
  });
  it('400 body desconocido; vacío aceptado', async () => {
    await request(app.getHttpServer()).get(url).set('Authorization', token()).send({ usuarioId: 'admin' }).expect(400);
    expect(leer).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get(url).set('Authorization', token()).send({}).expect(200);
  });
  it.each(['post', 'patch', 'delete', 'put'] as const)('método %s no registra ruta de escritura', async method => {
    await request(app.getHttpServer())[method](url).set('Authorization', token()).expect(404);
    expect(leer).not.toHaveBeenCalled();
  });
});
