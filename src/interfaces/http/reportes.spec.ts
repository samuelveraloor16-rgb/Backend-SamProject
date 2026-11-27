import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import request from 'supertest';
import { MetricasService } from '../../aplicacion/metricas/metricas.service';
import { MAX_REPORTE_BYTES, ReportesService } from '../../aplicacion/reportes/reportes.service';
import { METRICAS_REPOSITORY, type MetricasRepository } from '../../dominio/puertos/metricas.repository';
import { REPORTE_RESUMEN_RENDERER } from '../../dominio/puertos/reporte-resumen.renderer';
import { USUARIO_REPOSITORY } from '../../dominio/puertos/usuario.repository';
import { acumularAcotado, COLUMNAS_RESUMEN, ResumenRenderer, textoCsv } from '../../infraestructura/reportes/resumen.renderer';
import { ReportesController } from './reportes.controller';
import { MetricasController } from './metricas.controller';
import { JwtStrategy } from './jwt.strategy';
import { HttpExceptionFilter } from './http-exception.filter';

// RFC4180 parser independiente de la serialización, campos multilinea incluidos.
function parseCsv(buffer: Buffer): string[][] {
  const csv = buffer.toString('utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && c === ',') { row.push(value); value = ''; }
    else if (!quoted && c === '\r') {
      expect(csv[++i]).toBe('\n'); row.push(value); rows.push(row); row = []; value = '';
    } else { if (!quoted) expect(c).not.toBe('\n'); value += c; }
  }
  expect(quoted).toBe(false); expect(value).toBe(''); expect(row).toEqual([]);
  return rows;
}
function parsePdf(buffer: Buffer): { pages: { text: string; fonts: string[]; operators: number }[] } {
  return JSON.parse(execFileSync(process.execPath, ['scripts/inspeccionar-pdf-rf23.mjs'], { input: buffer }).toString());
}

describe('RF23 HTTP offline aislado con JWT real, sin AppModule/BD', () => {
  let app: INestApplication;
  let leer: jest.MockedFunction<MetricasRepository['leerInstantaneaVisible']>;
  let render: jest.SpyInstance;
  let nombre: string;
  const jwt = new JwtService({ secret: 'solo-rf23-offline' });
  const token = (id = 'miembro', version = 0) => `Bearer ${jwt.sign({ sub: id, tokenVersion: version })}`;
  const url = (formato: string, id = 'p1') => `/api/v1/proyectos/${encodeURIComponent(id)}/reportes/resumen.${formato}`;
  const corte = new Date('2026-11-26T12:00:00.000Z');
  beforeEach(async () => {
    nombre = 'Diseño, "Árbol"\nAcadémico';
    leer = jest.fn(async (id, usuario) => ['p1', 'archivo', 'bandeja', 'vacio'].includes(id) && ['miembro', 'admin'].includes(usuario) ? {
      proyecto: { id, nombre }, calculadoEn: corte,
      contables: id === 'vacio' ? [] : [
        { estado: 'HECHA' as const, fechaLimite: null },
        { estado: 'PENDIENTE' as const, fechaLimite: new Date('2020-01-01') },
        { estado: 'EN_CURSO' as const, fechaLimite: null },
      ], historial: { desde: null, coberturaAcreditada: false, grupos: [] },
    } : null);
    const renderer = new ResumenRenderer(); render = jest.spyOn(renderer, 'generar');
    const modulo = await Test.createTestingModule({
      controllers: [ReportesController, MetricasController],
      providers: [MetricasService, ReportesService, JwtStrategy,
        { provide: METRICAS_REPOSITORY, useValue: { leerInstantaneaVisible: leer } },
        { provide: REPORTE_RESUMEN_RENDERER, useValue: renderer },
        { provide: ConfigService, useValue: { get: () => 'solo-rf23-offline' } },
        { provide: USUARIO_REPOSITORY, useValue: { buscarPorId: async (id: string) => ['miembro', 'admin', 'ajeno'].includes(id) ? { id, tokenVersion: 0 } : null } }],
    }).compile();
    app = modulo.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter()); await app.init();
  });
  afterEach(async () => app.close());
  async function download(formato: string, id = 'p1', usuario = 'miembro') {
    return request(app.getHttpServer()).get(url(formato, id)).set('Authorization', token(usuario)).buffer(true)
      .parse((res, callback) => { const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk))); res.on('end', () => callback(null, Buffer.concat(chunks))); });
  }

  it.each(['csv', 'pdf'])('cabeceras, mismo snapshot fixture y valores RF22 sin recálculo %s', async formato => {
    const api = await request(app.getHttpServer()).get('/api/v1/proyectos/p1/metricas').set('Authorization', token()).expect(200);
    const r = await download(formato); expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe(formato === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf');
    expect(r.headers['content-disposition']).toBe(`attachment; filename="resumen-proyecto.${formato}"`);
    expect(r.headers['cache-control']).toBe('private, no-store'); expect(r.headers['x-content-type-options']).toBe('nosniff');
    const valores = ['p1', nombre, api.body.calculadoEn, ...['progreso', 'total', 'hechas', 'pendientes', 'enCurso', 'trabajoPendiente', 'vencidas'].map(k => String(api.body[k])), 'NO_DISPONIBLE', api.body.ritmo.motivo, ''];
    if (formato === 'csv') expect(parseCsv(r.body)).toEqual([[...COLUMNAS_RESUMEN], valores]);
    else {
      const parsed = parsePdf(r.body); expect(parsed.pages.length).toBeGreaterThan(0);
      const text = parsed.pages.map(p => p.text).join('\n');
      for (const [i, campo] of COLUMNAS_RESUMEN.entries()) {
        if (campo !== 'proyectoNombre') expect(text).toContain(`${campo}: ${valores[i]}`.trimEnd());
      }
      expect(text).toContain('Diseño, "Árbol"'); expect(text).toContain('Académico');
      expect(parsed.pages.every(p => p.operators > 0 && p.fonts.length > 0)).toBe(true);
      expect(r.body.toString('latin1')).toContain('/FontFile2');
    }
    expect(leer).toHaveBeenCalledTimes(2); // una para API, una para descarga, nunca lookup nombre extra
    expect(api.body).not.toHaveProperty('nombre'); expect(api.body.ritmo).toEqual({ disponible: false, motivo: 'COBERTURA_NO_ACREDITADA' });
  });
  it.each(['csv', 'pdf'])('admin/archivo/Bandeja/vacío mantienen permisos RF22 %s', async formato => {
    for (const id of ['archivo', 'bandeja', 'vacio']) {
      const r = await download(formato, id, 'admin'); expect(r.status).toBe(200);
      if (id === 'vacio' && formato === 'csv') expect(parseCsv(r.body)[1]!.slice(3, 10)).toEqual(['0', '0', '0', '0', '0', '0', '0']);
    }
  });
  it.each(['csv', 'pdf'])('401 tokens ausente/inválido/revocado/caducado sin renderer %s', async formato => {
    for (const auth of [undefined, 'Bearer basura', token('miembro', 1), `Bearer ${jwt.sign({ sub: 'miembro', tokenVersion: 0 }, { expiresIn: -1 })}`]) {
      const req = request(app.getHttpServer()).get(url(formato)); if (auth) req.set('Authorization', auth);
      const r = await req.expect(401); expect(r.headers['content-disposition']).toBeUndefined();
    }
    expect(leer).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled();
  });
  it.each(['csv', 'pdf'])('404 ajeno/inexistente/eliminado sin fuga %s', async formato => {
    let previo: unknown;
    for (const [id, usuario] of [['p1', 'ajeno'], ['no-existe', 'miembro'], ['eliminado', 'miembro']]) {
      const r = await request(app.getHttpServer()).get(url(formato, id)).set('Authorization', token(usuario)).expect(404);
      expect(r.body).toEqual({ statusCode: 404, message: 'Proyecto no encontrado', error: 'Not Found' });
      if (previo) expect(r.body).toEqual(previo); previo = r.body;
      expect(r.headers['content-disposition']).toBeUndefined();
    }
    expect(render).not.toHaveBeenCalled();
  });
  it.each(['csv', 'pdf'])('400 filtros/body/tokenURL y filename sin inyección %s', async formato => {
    for (const query of ['filtro=x', 'token=secreto', 'usuarioId=admin', 'formato=csv']) {
      await request(app.getHttpServer()).get(`${url(formato)}?${query}`).set('Authorization', token()).expect(400);
    }
    await request(app.getHttpServer()).get(url(formato)).set('Authorization', token()).send({ corte: 'ayer' }).expect(400);
    expect(leer).not.toHaveBeenCalled();
    nombre = 'Nombre\r\nContent-Disposition: ../../otro';
    const r = await download(formato); expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toBe(`attachment; filename="resumen-proyecto.${formato}"`);
    const invalid = await request(app.getHttpServer()).get(url(formato, '../../otro\r\nX: uno')).set('Authorization', token());
    expect(invalid.status).toBe(404); expect(invalid.headers['content-disposition']).toBeUndefined();
  });
  it('CSV Unicode sin limitar glifos y fórmula neutralizada', async () => {
    nombre = '\u200b\t=HYPERLINK("https://no")\r\n漢字 😀';
    const r = await download('csv'); expect(r.status).toBe(200);
    expect(parseCsv(r.body)[1]![1]).toBe("'" + nombre);
  });
  it('PDF acentos/nombre largo preservados, glifo fuera de fuente falla explícito sin descarga', async () => {
    nombre = 'Árbol '.repeat(100) + 'FIN';
    const largo = await download('pdf'); expect(largo.status).toBe(200);
    expect(parsePdf(largo.body).pages.map(p => p.text).join('\n')).toContain('FIN');
    for (const texto of ['漢字', '😀', '\tNombre', '\u200bNombre']) {
      nombre = texto;
      const r = await request(app.getHttpServer()).get(url('pdf')).set('Authorization', token()).expect(422);
      expect(r.body.message).toBe('Contenido no representable en PDF'); expect(r.headers['content-disposition']).toBeUndefined();
      expect(r.headers['content-type']).toContain('application/json');
    }
  });
  it.each(['csv', 'pdf'])('límites entrada/salida/fallo generador no dejan descarga parcial %s', async formato => {
    for (const texto of ['a'.repeat(1001), 'línea\n'.repeat(33), '\ud800']) {
      nombre = texto; const r = await request(app.getHttpServer()).get(url(formato)).set('Authorization', token()).expect(422);
      expect(r.headers['content-disposition']).toBeUndefined();
    }
    expect(render).not.toHaveBeenCalled(); nombre = 'Normal';
    render.mockResolvedValueOnce(Buffer.alloc(MAX_REPORTE_BYTES + 1));
    const limite = await request(app.getHttpServer()).get(url(formato)).set('Authorization', token()).expect(422);
    expect(limite.headers['content-disposition']).toBeUndefined();
    render.mockRejectedValueOnce(new Error('contenido privado JWT stack'));
    const fallo = await request(app.getHttpServer()).get(url(formato)).set('Authorization', token()).expect(500);
    expect(fallo.body.message).toBe('No se pudo generar el reporte'); expect(JSON.stringify(fallo.body)).not.toContain('privado');
    expect(fallo.headers['content-disposition']).toBeUndefined(); expect(fallo.headers['content-type']).toContain('application/json');
  });
});

describe('RF23 neutralización y buffer acotado', () => {
  it('renderer PDF directo', async () => {
    const renderer = new ResumenRenderer();
    const resultado = await renderer.generar({ proyecto: { id: 'p', nombre: 'Árbol' }, metricas: {
      proyectoId: 'p', calculadoEn: new Date(), progreso: 0, total: 0, hechas: 0, pendientes: 0, enCurso: 0, trabajoPendiente: 0, vencidas: 0,
      ritmo: { disponible: false, motivo: 'COBERTURA_NO_ACREDITADA' },
    } }, 'pdf');
    expect(resultado.length).toBeGreaterThan(100);
  });
  it('ambos renderers copian cifras literales aun cuando fixture no cumple sumas', async () => {
    const renderer = new ResumenRenderer();
    const fixture = { proyecto: { id: 'p', nombre: 'Literal' }, metricas: {
      proyectoId: 'p', calculadoEn: new Date('2026-11-26T12:00:00.000Z'), progreso: 12.4, total: 97,
      hechas: 4, pendientes: 13, enCurso: 9, trabajoPendiente: 777, vencidas: 88,
      ritmo: { disponible: false as const, motivo: 'COBERTURA_NO_ACREDITADA' as const },
    } };
    const csv = parseCsv(await renderer.generar(fixture, 'csv'))[1]!;
    expect(csv.slice(3, 10)).toEqual(['12.4', '97', '4', '13', '9', '777', '88']);
    const text = parsePdf(await renderer.generar(fixture, 'pdf')).pages.map(p => p.text).join('\n');
    for (const [campo, valor] of Object.entries({ progreso: 12.4, total: 97, hechas: 4, pendientes: 13, enCurso: 9, trabajoPendiente: 777, vencidas: 88 })) expect(text).toContain(`${campo}: ${valor}`);
  });
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '  =x', '\t=x', '\r=x', '\n=x', '\u00a0=x', '\u200b=x', '\u2066=x', '\ttexto', '\u0000texto'])('texto seguro %j', texto => {
    expect(textoCsv(texto)).toBe(`"'${texto.replace(/"/g, '""')}"`);
  });
  it('RFC4180 no altera comas/comillas/newlines seguros', () => expect(textoCsv('Árbol, "x"\nfin')).toBe('"Árbol, ""x""\nfin"'));
  it('corta acumulación antes de buffer total y propaga fallo stream', async () => {
    const stream = Readable.from([Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)]);
    await expect(acumularAcotado(stream, 10)).rejects.toMatchObject({ status: 422 }); expect(stream.destroyed).toBe(true);
    const roto = Readable.from((async function* () { yield Buffer.from('parte'); throw new Error('fallo'); })());
    await expect(acumularAcotado(roto)).rejects.toThrow('fallo');
    expect(await acumularAcotado(Readable.from([Buffer.alloc(10)]), 10)).toHaveLength(10);
  });
});
