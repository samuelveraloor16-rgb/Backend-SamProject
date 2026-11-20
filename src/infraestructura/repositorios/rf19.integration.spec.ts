import 'dotenv/config';
import { createHash, randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { Client } from 'pg';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaComentariosRepository } from './prisma-comentarios.repository';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { conErroresTransitorios } from '../prisma/errores-transitorios';
import { HttpExceptionFilter } from '../../interfaces/http/http-exception.filter';
import { ejecutarLimpieza } from '../mantenimiento/limpiar-idempotencias';

// Opt-in: crea y elimina exclusivamente una BD de nombre aleatorio generado aquí.
const integration = process.env.RF19_INTEGRATION === '1' ? describe : describe.skip;
integration('RF-19 PostgreSQL aislado', () => {
  let admin: Client;
  let prisma: PrismaService;
  let repo: PrismaComentariosRepository;
  let app: INestApplication;
  let dbUrl = '';
  let dbName = '';
  let created = false;
  let previousKeys: string | undefined;
  let previousActive: string | undefined;
  const ids = { a: 'rf19_a', b: 'rf19_b', otro: 'rf19_otro', espacio: 'rf19_esp', proyecto: 'rf19_p', destino: 'rf19_p2', tarea: 'rf19_t' };
  async function esperarBloqueo(consulta: string, params: unknown[]) {
    const limite = Date.now() + 5000;
    while (Date.now() < limite) {
      const result = await admin.query<{ bloqueado: boolean }>(consulta, params);
      if (result.rows[0]?.bloqueado) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('No se observó el bloqueo PostgreSQL esperado');
  }
  beforeAll(async () => {
    previousKeys = process.env.COMENTARIOS_HMAC_CLAVES;
    previousActive = process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA;
    process.env.COMENTARIOS_HMAC_CLAVES = JSON.stringify({ prueba: randomBytes(32).toString('hex') });
    process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA = 'prueba';
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requerida');
    const base = new URL(process.env.DATABASE_URL);
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname)) throw new Error('Solo PostgreSQL local para esta prueba');
    dbName = `rf19_test_${randomBytes(12).toString('hex')}`;
    if (!/^rf19_test_[a-f0-9]{24}$/.test(dbName)) throw new Error('Nombre de BD inseguro');
    admin = new Client({ connectionString: base.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;
    const testUrl = new URL(base); testUrl.pathname = `/${dbName}`;
    dbUrl = testUrl.toString();
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: 'pipe' });
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: testUrl.toString() }));
    await prisma.$connect(); repo = new PrismaComentariosRepository(prisma);
    for (const id of [ids.a, ids.b, ids.otro]) await prisma.usuario.create({ data: { id, email: `${id}@example.test`, nombre: id, passwordHash: 'hash' } });
    await prisma.espacioDeTrabajo.create({ data: { id: ids.espacio, nombre: 'Test', membresias: { create: [{ usuarioId: ids.a }, { usuarioId: ids.b }] }, proyectos: { create: [{ id: ids.proyecto, nombre: 'P' }, { id: ids.destino, nombre: 'D' }] } } });
    await prisma.tarea.create({ data: { id: ids.tarea, titulo: 'T', proyectoId: ids.proyecto } });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    if (admin && created && /^rf19_test_[a-f0-9]{24}$/.test(dbName)) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    }
    if (admin) await admin.end();
    if (previousKeys === undefined) delete process.env.COMENTARIOS_HMAC_CLAVES; else process.env.COMENTARIOS_HMAC_CLAVES = previousKeys;
    if (previousActive === undefined) delete process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA; else process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA = previousActive;
  });
  it('crea una sola publicación y aviso ante 12 reintentos concurrentes', async () => {
    const resultados = await Promise.all(Array.from({ length: 12 }, () => repo.crear(ids.tarea, ids.a, `@[${ids.a}] @[${ids.b}]`, 'concurrente', [ids.a, ids.b])));
    expect(resultados.filter(r => !r.replay)).toHaveLength(1);
    expect(new Set(resultados.map(r => (r.comentario as { id: string }).id)).size).toBe(1);
    expect(await prisma.notificacion.count()).toBe(1);
    expect(await prisma.mencion.count()).toBe(2);
    const registro = await prisma.idempotenciaComentario.findUniqueOrThrow({ where: { usuarioId_clave: { usuarioId: ids.a, clave: 'concurrente' } } });
    expect(registro.expiraEn.getTime() - Date.now()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    await expect(repo.crear(ids.tarea, ids.a, 'diferente', 'concurrente', [])).rejects.toMatchObject({ status: 409 });
  });
  it('la migración aditiva conserva marcadores históricos y tombstones existentes', async () => {
    const cliente = new Client({ connectionString: dbUrl });
    await cliente.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('CREATE TEMP TABLE idempotencias_comentario ("usuarioId" text, clave text, huella text, "comentarioId" text, "expiraEn" timestamp(3))');
      await cliente.query('INSERT INTO idempotencias_comentario VALUES ($1,$2,$3,$4,$5),($1,$6,$3,NULL,$7)', ['u', 'activa', 'legacy', 'c', new Date('2030-01-01T00:00:00Z'), 'tombstone', new Date('9999-12-31T23:59:59Z')]);
      const sql = readFileSync('prisma/migrations/20261121000000_idempotencia_generacion/migration.sql', 'utf8');
      await cliente.query(sql);
      const resultado = await cliente.query<{ total: string; intactos: string }>('SELECT count(*) AS total, count(*) FILTER (WHERE "generacion" IS NULL AND huella = $1 AND ("comentarioId" = $2 OR "comentarioId" IS NULL)) AS intactos FROM idempotencias_comentario', ['legacy', 'c']);
      expect(resultado.rows[0]).toEqual({ total: '2', intactos: '2' });
    } finally { await cliente.query('ROLLBACK').catch(() => undefined); await cliente.end(); }
  });
  it('valida destinatarios y no guarda efectos parciales', async () => {
    await expect(repo.crear(ids.tarea, ids.a, 'texto', 'invalido', [ids.otro])).rejects.toMatchObject({ status: 400 });
    expect(await prisma.idempotenciaComentario.findUnique({ where: { usuarioId_clave: { usuarioId: ids.a, clave: 'invalido' } } })).toBeNull();
    await expect(repo.crear(ids.tarea, ids.otro, 'texto', 'ajeno', [])).rejects.toMatchObject({ status: 404 });
  });
  it('una clave concurrente con cuerpos distintos confirma como máximo uno', async () => {
    const resultados = await Promise.allSettled([
      repo.crear(ids.tarea, ids.a, 'contenido A', 'colision', []),
      repo.crear(ids.tarea, ids.a, 'contenido B', 'colision', []),
    ]);
    expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({ status: 409 });
    expect(await prisma.comentario.count({ where: { texto: { in: ['contenido A', 'contenido B'] } } })).toBe(1);
  });
  it('oculta avisos tras revocación y los recupera al reingresar; permite marcar leído', async () => {
    const listado = await repo.notificaciones(ids.b, 1, 20);
    expect(listado.meta.total).toBe(1);
    const id = listado.datos[0]!.id;
    await prisma.membresia.delete({ where: { usuarioId_espacioId: { usuarioId: ids.b, espacioId: ids.espacio } } });
    expect((await repo.notificaciones(ids.b, 1, 20)).meta.total).toBe(0);
    await expect(repo.leer(id, ids.b)).rejects.toMatchObject({ status: 404 });
    await prisma.membresia.create({ data: { usuarioId: ids.b, espacioId: ids.espacio } });
    expect((await repo.leer(id, ids.b)).leida).toBe(true);
  });
  it('proyecto archivado rechaza creación pero permite replay y consultas', async () => {
    await prisma.proyecto.update({ where: { id: ids.proyecto }, data: { archivado: true } });
    await expect(repo.crear(ids.tarea, ids.a, 'otro', 'archivado', [])).rejects.toMatchObject({ status: 400 });
    expect((await repo.crear(ids.tarea, ids.a, `@[${ids.a}] @[${ids.b}]`, 'concurrente', [ids.a, ids.b])).replay).toBe(true);
    expect((await repo.listar(ids.tarea, ids.a, 1, 20)).meta.total).toBe(2);
    await prisma.proyecto.update({ where: { id: ids.proyecto }, data: { archivado: false } });
  });
  it('expone rutas HTTP con JWT, validación, directorio e idempotencia', async () => {
    const token = app.get(JwtService).sign({ sub: ids.a, tokenVersion: 0 });
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server).get(`/api/v1/tareas/${ids.tarea}/comentarios`).expect(401);
    const directorio = await request(server).get(`/api/v1/tareas/${ids.tarea}/miembros-mencionables?q=rf19`).auth(token, { type: 'bearer' }).expect(200);
    expect(directorio.body.meta.total).toBe(2);
    await request(server).get(`/api/v1/tareas/${ids.tarea}/miembros-mencionables?q=%20`).auth(token, { type: 'bearer' }).expect(400);
    await request(server).post(`/api/v1/tareas/${ids.tarea}/comentarios`).auth(token, { type: 'bearer' }).send({ texto: 'hola' }).expect(400);
    const post = () => request(server).post(`/api/v1/tareas/${ids.tarea}/comentarios`).auth(token, { type: 'bearer' }).set('Idempotency-Key', 'httpkey').send({ texto: 'hola' });
    const primero = await post().expect(201);
    expect(primero.headers['idempotency-replayed']).toBe('false');
    const replay = await post().expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.id).toBe(primero.body.id);
    await request(server).patch('/api/v1/notificaciones/inexistente/leida').auth(token, { type: 'bearer' }).send({ extra: true }).expect(400);
    const tokenB = app.get(JwtService).sign({ sub: ids.b, tokenVersion: 0 });
    const notificacion = (await repo.notificaciones(ids.b, 1, 20)).datos[0]!;
    await request(server).patch(`/api/v1/notificaciones/${notificacion.id}/leida`).auth(tokenB, { type: 'bearer' }).expect(200);
    await prisma.comentario.delete({ where: { id: primero.body.id as string } });
  });
  it('coordina revocación, archivo y movimiento con escrituras PostgreSQL existentes', async () => {
    const cliente = new Client({ connectionString: dbUrl });
    await cliente.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('DELETE FROM "membresias" WHERE "usuarioId"=$1 AND "espacioId"=$2', [ids.b, ids.espacio]);
      const revocada = repo.crear(ids.tarea, ids.a, 'revocada', 'race_rev', [ids.b]);
      await new Promise(resolve => setTimeout(resolve, 100));
      await cliente.query('COMMIT');
      await expect(revocada).rejects.toMatchObject({ status: 400 });
      await prisma.membresia.create({ data: { usuarioId: ids.b, espacioId: ids.espacio } });

      await cliente.query('BEGIN');
      await cliente.query('UPDATE "proyectos" SET "archivado"=true WHERE "id"=$1', [ids.proyecto]);
      const archivada = repo.crear(ids.tarea, ids.a, 'archivada', 'race_arc', []);
      await new Promise(resolve => setTimeout(resolve, 100));
      await cliente.query('COMMIT');
      await expect(archivada).rejects.toMatchObject({ status: 400 });
      await prisma.proyecto.update({ where: { id: ids.proyecto }, data: { archivado: false } });

      await cliente.query('BEGIN');
      await cliente.query('UPDATE "tareas" SET "proyectoId"=$1 WHERE "id"=$2', [ids.destino, ids.tarea]);
      const movida = repo.crear(ids.tarea, ids.a, 'movida', 'race_mov', []);
      await new Promise(resolve => setTimeout(resolve, 100));
      await cliente.query('COMMIT');
      await expect(movida).rejects.toMatchObject({ status: 503 });
      expect(await prisma.idempotenciaComentario.count({ where: { clave: { in: ['race_rev', 'race_arc', 'race_mov'] } } })).toBe(0);
      await prisma.tarea.update({ where: { id: ids.tarea }, data: { proyectoId: ids.proyecto } });
    } finally { await cliente.end(); }
  }, 20000);
  it('ordena publicación antes de revocación, archivo, movimiento y borrado inversos', async () => {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION rf19_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.texto LIKE 'interleave_%' THEN PERFORM pg_advisory_xact_lock(818118); END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER rf19_test_pause BEFORE INSERT ON "comentarios" FOR EACH ROW EXECUTE FUNCTION rf19_test_pause()');
    const barrera = new Client({ connectionString: dbUrl });
    const escritor = new Client({ connectionString: dbUrl });
    await barrera.connect(); await escritor.connect();
    const barrierPid = (await barrera.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const writerPid = (await escritor.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const esperaPublicacion = 'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$2 AND $1 = ANY(pg_blocking_pids(pid))) AS bloqueado';
    const esperaEscritura = 'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type=\'Lock\') AS bloqueado';
    try {
      for (const caso of ['revocar', 'archivar', 'mover', 'borrar']) {
        const proyecto = `reverse_p_${caso}`; const tarea = `reverse_t_${caso}`;
        await prisma.proyecto.create({ data: { id: proyecto, espacioId: ids.espacio, nombre: proyecto } });
        await prisma.tarea.create({ data: { id: tarea, proyectoId: proyecto, titulo: tarea } });
        await barrera.query('BEGIN');
        await barrera.query('SELECT pg_advisory_xact_lock(818118)');
        const publicacion = repo.crear(tarea, ids.a, `interleave_${caso}`, `reverse_${caso}`, [ids.b]);
        await esperarBloqueo(esperaPublicacion, [barrierPid, dbName]);
        let sql: string; let params: string[];
        if (caso === 'revocar') { sql = 'DELETE FROM "membresias" WHERE "usuarioId"=$1 AND "espacioId"=$2'; params = [ids.b, ids.espacio]; }
        else if (caso === 'archivar') { sql = 'UPDATE "proyectos" SET "archivado"=true WHERE id=$1'; params = [proyecto]; }
        else if (caso === 'mover') { sql = 'UPDATE "tareas" SET "proyectoId"=$1 WHERE id=$2'; params = [ids.destino, tarea]; }
        else { sql = 'DELETE FROM "proyectos" WHERE id=$1'; params = [proyecto]; }
        const cambio = escritor.query(sql, params);
        await esperarBloqueo(esperaEscritura, [writerPid]);
        await barrera.query('COMMIT');
        const creada = await publicacion; await cambio;
        const comentarioId = (creada.comentario as { id: string }).id;
        if (caso === 'revocar') {
          expect((await repo.notificaciones(ids.b, 1, 100)).datos.some(n => n.datos.comentarioId === comentarioId)).toBe(false);
          await prisma.membresia.create({ data: { usuarioId: ids.b, espacioId: ids.espacio } });
        }
        if (caso === 'mover') expect((await prisma.tarea.findUnique({ where: { id: tarea } }))?.proyectoId).toBe(ids.destino);
        if (caso === 'archivar') expect((await prisma.proyecto.findUnique({ where: { id: proyecto } }))?.archivado).toBe(true);
        if (caso === 'borrar') expect(await prisma.comentario.findUnique({ where: { id: comentarioId } })).toBeNull();
        await prisma.tarea.deleteMany({ where: { id: tarea } });
        await prisma.proyecto.deleteMany({ where: { id: proyecto } });
      }
    } finally {
      await barrera.query('ROLLBACK').catch(() => undefined);
      await barrera.end(); await escritor.end();
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS rf19_test_pause ON "comentarios"');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS rf19_test_pause()');
    }
  }, 40000);
  it('baja física del destinatario espera publicación ya autorizada', async () => {
    const usuario = await prisma.usuario.create({ data: { email: 'concurrente@test.invalid', nombre: 'Concurrente', passwordHash: 'x' } });
    await prisma.membresia.create({ data: { usuarioId: usuario.id, espacioId: ids.espacio } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION rf19_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.texto = 'interleave_baja' THEN PERFORM pg_advisory_xact_lock(818118); END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER rf19_test_pause BEFORE INSERT ON "comentarios" FOR EACH ROW EXECUTE FUNCTION rf19_test_pause()');
    const barrera = new Client({ connectionString: dbUrl }); const escritor = new Client({ connectionString: dbUrl });
    await barrera.connect(); await escritor.connect();
    try {
      const barrierPid = (await barrera.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const writerPid = (await escritor.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await barrera.query('BEGIN'); await barrera.query('SELECT pg_advisory_xact_lock(818118)');
      const publicacion = repo.crear(ids.tarea, ids.a, 'interleave_baja', 'reverse_user_delete', [usuario.id]);
      await esperarBloqueo('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$2 AND $1 = ANY(pg_blocking_pids(pid))) AS bloqueado', [barrierPid, dbName]);
      const baja = escritor.query('DELETE FROM "usuarios" WHERE id=$1', [usuario.id]);
      await esperarBloqueo('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type=\'Lock\') AS bloqueado', [writerPid]);
      await barrera.query('COMMIT');
      const creada = await publicacion; await baja;
      const comentarioId = (creada.comentario as { id: string }).id;
      expect(await prisma.comentario.findUnique({ where: { id: comentarioId } })).not.toBeNull();
      expect(await prisma.mencion.count({ where: { comentarioId } })).toBe(0);
      expect(await prisma.notificacion.count({ where: { comentarioId } })).toBe(0);
      await prisma.comentario.delete({ where: { id: comentarioId } });
    } finally {
      await barrera.query('ROLLBACK').catch(() => undefined);
      await barrera.end(); await escritor.end();
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS rf19_test_pause ON "comentarios"');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS rf19_test_pause()');
    }
  }, 20000);
  it('publicación espera una baja de usuario anterior y rechaza destinatario tras commit', async () => {
    const usuario = await prisma.usuario.create({ data: { email: 'baja-primero@test.invalid', nombre: 'Baja primero', passwordHash: 'x' } });
    await prisma.membresia.create({ data: { usuarioId: usuario.id, espacioId: ids.espacio } });
    const externo = new Client({ connectionString: dbUrl }); await externo.connect();
    try {
      await externo.query('BEGIN');
      await externo.query('DELETE FROM "usuarios" WHERE id=$1', [usuario.id]);
      const pid = (await externo.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const publicacion = repo.crear(ids.tarea, ids.a, 'destinatario eliminado', 'user_delete_first', [usuario.id]);
      await esperarBloqueo('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$2 AND $1 = ANY(pg_blocking_pids(pid))) AS bloqueado', [pid, dbName]);
      await externo.query('COMMIT');
      await expect(publicacion).rejects.toMatchObject({ status: 400 });
      expect(await prisma.idempotenciaComentario.count({ where: { clave: 'user_delete_first' } })).toBe(0);
    } finally { await externo.query('ROLLBACK').catch(() => undefined); await externo.end(); }
  }, 20000);
  it('traduce un deadlock PostgreSQL real a 503', async () => {
    const externo = new Client({ connectionString: dbUrl }); await externo.connect();
    try {
      await externo.query('BEGIN');
      await externo.query('SELECT id FROM "usuarios" WHERE id=$1 FOR UPDATE', [ids.b]);
      const pid = (await externo.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      let espera: Promise<unknown> | undefined;
      const conflicto = conErroresTransitorios(() => prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL deadlock_timeout = '50ms'`;
        await tx.$queryRaw`SELECT id FROM "usuarios" WHERE id=${ids.a} FOR UPDATE`;
        espera = externo.query('SELECT id FROM "usuarios" WHERE id=$1 FOR UPDATE', [ids.a]);
        await esperarBloqueo('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type=\'Lock\') AS bloqueado', [pid]);
        await tx.$queryRaw`SELECT id FROM "usuarios" WHERE id=${ids.b} FOR UPDATE`;
      }, { timeout: 10000 }));
      await expect(conflicto).rejects.toMatchObject({ status: 503 });
      await espera;
    } finally { await externo.query('ROLLBACK').catch(() => undefined); await externo.end(); }
  }, 20000);
  it('un lock_timeout real en publicación HTTP devuelve 503 y permite reintentar la clave', async () => {
    const url = new URL(dbUrl); url.searchParams.set('options', '-c lock_timeout=200ms');
    const prismaTimeout = new PrismaService(new ConfigService({ DATABASE_URL: url.toString() }));
    let appTimeout: INestApplication | undefined;
    const externo = new Client({ connectionString: dbUrl }); await externo.connect();
    try {
      await prismaTimeout.$connect();
      const setting = await prismaTimeout.$queryRaw<{ lock_timeout: string }[]>`SHOW lock_timeout`;
      expect(setting[0]?.lock_timeout).toBe('200ms');
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prismaTimeout).compile();
      appTimeout = module.createNestApplication();
      appTimeout.setGlobalPrefix('api/v1');
      appTimeout.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      appTimeout.useGlobalFilters(new HttpExceptionFilter());
      await appTimeout.init();
      const token = appTimeout.get(JwtService).sign({ sub: ids.a, tokenVersion: 0 });
      const server = appTimeout.getHttpServer() as Parameters<typeof request>[0];
      await externo.query('BEGIN'); await externo.query('SELECT id FROM "proyectos" WHERE id=$1 FOR UPDATE', [ids.proyecto]);
      const post = () => request(server).post(`/api/v1/tareas/${ids.tarea}/comentarios`).auth(token, { type: 'bearer' }).set('Idempotency-Key', 'timeout_http').send({ texto: 'reintento timeout' });
      const fallo = await post().expect(503);
      expect(fallo.body).toMatchObject({ statusCode: 503, error: 'Service Unavailable' });
      expect(await prisma.idempotenciaComentario.count({ where: { clave: 'timeout_http' } })).toBe(0);
      await externo.query('COMMIT');
      const primera = await post().expect(201);
      const repetida = await post().expect(201);
      expect(repetida.body.id).toBe(primera.body.id);
      expect(repetida.headers['idempotency-replayed']).toBe('true');
      await prisma.comentario.delete({ where: { id: primera.body.id as string } });
    } finally {
      await externo.query('ROLLBACK').catch(() => undefined); await externo.end();
      if (appTimeout) await appTimeout.close();
      await prismaTimeout.$disconnect();
    }
  }, 20000);
  it('un timeout real de transacción Prisma devuelve 503 sin efectos parciales', async () => {
    const externo = new Client({ connectionString: dbUrl }); await externo.connect();
    try {
      await externo.query('BEGIN');
      await externo.query('SELECT id FROM "proyectos" WHERE id=$1 FOR UPDATE', [ids.proyecto]);
      const resultado = repo.crear(ids.tarea, ids.a, 'timeout transacción', 'timeout_tx', []);
      const liberacion = new Promise<void>((resolve, reject) => {
        setTimeout(() => { externo.query('COMMIT').then(() => resolve(), reject); }, 11000);
      });
      await expect(resultado).rejects.toMatchObject({ status: 503 });
      await liberacion;
      expect(await prisma.idempotenciaComentario.count({ where: { clave: 'timeout_tx' } })).toBe(0);
      expect(await prisma.comentario.count({ where: { texto: 'timeout transacción' } })).toBe(0);
    } finally { await externo.query('ROLLBACK').catch(() => undefined); await externo.end(); }
  }, 20000);
  it('oculta avisos sin vínculo o sin mención verificable', async () => {
    await prisma.notificacion.create({ data: { usuarioId: ids.b, tipo: 'MENCION', titulo: 'Antigua', datos: { tareaId: ids.tarea } } });
    expect((await repo.notificaciones(ids.b, 1, 100)).meta.total).toBe(1);
  });
  it('replay requiere acceso actual y vencimiento permite una intención nueva', async () => {
    await prisma.membresia.delete({ where: { usuarioId_espacioId: { usuarioId: ids.a, espacioId: ids.espacio } } });
    await expect(repo.crear(ids.tarea, ids.a, `@[${ids.a}] @[${ids.b}]`, 'concurrente', [ids.a, ids.b])).rejects.toMatchObject({ status: 404 });
    await prisma.membresia.create({ data: { usuarioId: ids.a, espacioId: ids.espacio } });
    await repo.crear(ids.tarea, ids.a, 'antes', 'vencida', []);
    await prisma.idempotenciaComentario.update({ where: { usuarioId_clave: { usuarioId: ids.a, clave: 'vencida' } }, data: { expiraEn: new Date(0) } });
    const nueva = await repo.crear(ids.tarea, ids.a, 'después', 'vencida', []);
    expect(nueva.replay).toBe(false);
  });
  it('repara marcador sin caducidad tras una caída posterior al commit', async () => {
    const creada = await repo.crear(ids.tarea, ids.a, 'marcador pendiente', 'marcador_pendiente', []);
    await prisma.idempotenciaComentario.update({ where: { usuarioId_clave: { usuarioId: ids.a, clave: 'marcador_pendiente' } }, data: { expiraEn: new Date('9999-12-31T23:59:59.000Z') } });
    const replay = await repo.crear(ids.tarea, ids.a, 'marcador pendiente', 'marcador_pendiente', []);
    expect(replay.replay).toBe(true);
    expect((replay.comentario as { id: string }).id).toBe((creada.comentario as { id: string }).id);
    const registro = await prisma.idempotenciaComentario.findUniqueOrThrow({ where: { usuarioId_clave: { usuarioId: ids.a, clave: 'marcador_pendiente' } } });
    expect(registro.expiraEn.getTime() - Date.now()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });
  it('si falla la fijación posterior al commit conserva marcador y lo repara incluso con comentario borrado', async () => {
    let calls = 0;
    const sinFinalizar = new PrismaComentariosRepository({
      $transaction: (...args: Parameters<typeof prisma.$transaction>) => {
        calls++;
        if (calls === 2) return Promise.reject(new Error('fallo simulado posterior al commit'));
        return (prisma.$transaction as (...args: unknown[]) => unknown)(...args);
      },
    } as unknown as PrismaService);
    const creada = await sinFinalizar.crear(ids.tarea, ids.a, 'marcador seguro', 'fallo_finalizar', []);
    const id = (creada.comentario as { id: string }).id;
    const pendiente = await prisma.idempotenciaComentario.findUniqueOrThrow({ where: { usuarioId_clave: { usuarioId: ids.a, clave: 'fallo_finalizar' } } });
    expect(pendiente.expiraEn.getUTCFullYear()).toBe(9999);
    await prisma.comentario.delete({ where: { id } });
    await expect(repo.crear(ids.tarea, ids.a, 'marcador seguro', 'fallo_finalizar', [])).rejects.toMatchObject({ status: 404 });
    const reparado = await prisma.idempotenciaComentario.findUniqueOrThrow({ where: { usuarioId_clave: { usuarioId: ids.a, clave: 'fallo_finalizar' } } });
    expect(reparado.expiraEn.getTime() - Date.now()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });
  it('convierte huellas legacy reales, incluyendo tombstones, sin acortar el vencimiento', async () => {
    const texto = 'texto legacy';
    const creada = await repo.crear(ids.tarea, ids.a, texto, 'legacy_test', []);
    const where = { usuarioId_clave: { usuarioId: ids.a, clave: 'legacy_test' } };
    const legacy = createHash('sha256').update(JSON.stringify([ids.tarea, texto])).digest('hex');
    await prisma.idempotenciaComentario.update({ where, data: { huella: legacy, generacion: null } });
    const antes = await prisma.idempotenciaComentario.findUniqueOrThrow({ where });
    expect((await repo.crear(ids.tarea, ids.a, texto, 'legacy_test', [])).replay).toBe(true);
    const despues = await prisma.idempotenciaComentario.findUniqueOrThrow({ where });
    expect(despues.huella).toMatch(/^hmac-sha256-v1:prueba:/);
    expect(despues.expiraEn).toEqual(antes.expiraEn);
    await prisma.comentario.delete({ where: { id: (creada.comentario as { id: string }).id } });
    await prisma.idempotenciaComentario.update({ where, data: { huella: legacy } });
    await expect(repo.crear(ids.tarea, ids.a, texto, 'legacy_test', [])).rejects.toMatchObject({ status: 404 });
    expect((await prisma.idempotenciaComentario.findUniqueOrThrow({ where })).huella).toMatch(/^hmac-sha256-v1:prueba:/);
  });
  it('falla cerrado sin configuración sin afectar lecturas ni crear datos', async () => {
    const keys = process.env.COMENTARIOS_HMAC_CLAVES;
    delete process.env.COMENTARIOS_HMAC_CLAVES;
    try {
      await expect(repo.crear(ids.tarea, ids.a, 'x', 'sin_clave', [])).rejects.toMatchObject({ status: 503 });
      expect(await prisma.idempotenciaComentario.count({ where: { clave: 'sin_clave' } })).toBe(0);
      expect((await repo.listar(ids.tarea, ids.a, 1, 20)).datos).toBeDefined();
    } finally { process.env.COMENTARIOS_HMAC_CLAVES = keys; }
  });
  it('limpia solo vencidos y conserva marcadores 9999', async () => {
    await repo.crear(ids.tarea, ids.a, 'limpieza', 'limpieza', []);
    await prisma.idempotenciaComentario.update({ where: { usuarioId_clave: { usuarioId: ids.a, clave: 'limpieza' } }, data: { expiraEn: new Date(0) } });
    const sentinel = { usuarioId_clave: { usuarioId: ids.a, clave: 'marcador_pendiente' } };
    await prisma.idempotenciaComentario.update({ where: sentinel, data: { expiraEn: new Date('9999-12-31T23:59:59.000Z') } });
    expect(await repo.limpiarVencidas()).toBeGreaterThanOrEqual(1);
    expect(await prisma.idempotenciaComentario.findUnique({ where: { usuarioId_clave: { usuarioId: ids.a, clave: 'limpieza' } } })).toBeNull();
    expect((await prisma.idempotenciaComentario.findUniqueOrThrow({ where: sentinel })).expiraEn.getUTCFullYear()).toBe(9999);
  });
  it('entrada de mantenimiento limpia en BD aislada solo vencidos y conserva activos e históricos', async () => {
    const vencida = { usuarioId_clave: { usuarioId: ids.a, clave: 'cli_vencida' } };
    const activa = { usuarioId_clave: { usuarioId: ids.a, clave: 'cli_activa' } };
    const historica = { usuarioId_clave: { usuarioId: ids.a, clave: 'cli_historica' } };
    await repo.crear(ids.tarea, ids.a, 'vencida', 'cli_vencida', []);
    await repo.crear(ids.tarea, ids.a, 'activa', 'cli_activa', []);
    await repo.crear(ids.tarea, ids.a, 'histórica', 'cli_historica', []);
    await prisma.idempotenciaComentario.update({ where: vencida, data: { expiraEn: new Date(0) } });
    await prisma.idempotenciaComentario.update({ where: historica, data: { generacion: null, expiraEn: new Date('9999-12-31T23:59:59.000Z') } });
    const close = jest.fn().mockResolvedValue(undefined);
    const crear = jest.fn().mockResolvedValue({ get: () => repo, close });
    await expect(ejecutarLimpieza(undefined, ['--ejecutar'], crear)).rejects.toThrow();
    expect(crear).not.toHaveBeenCalled();
    expect(await prisma.idempotenciaComentario.findUnique({ where: vencida })).not.toBeNull();
    expect(await ejecutarLimpieza('true', ['--ejecutar'], crear)).toBeGreaterThanOrEqual(1);
    expect(await prisma.idempotenciaComentario.findUnique({ where: vencida })).toBeNull();
    expect(await prisma.idempotenciaComentario.findUnique({ where: activa })).not.toBeNull();
    expect(await prisma.idempotenciaComentario.findUnique({ where: historica })).not.toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('no permite que una finalización tardía afecte una generación reemplazada tras limpieza', async () => {
    let liberar!: () => void;
    let avisar!: () => void;
    const espera = new Promise<void>(resolve => { liberar = resolve; });
    const alcanzado = new Promise<void>(resolve => { avisar = resolve; });
    let llamadas = 0;
    const demorado = new PrismaComentariosRepository({
      $transaction: async (...args: Parameters<typeof prisma.$transaction>) => {
        if (++llamadas === 2) { avisar(); await espera; }
        return (prisma.$transaction as (...a: unknown[]) => Promise<unknown>)(...args);
      },
    } as unknown as PrismaService);
    const primera = demorado.crear(ids.tarea, ids.a, 'primera generación', 'carrera_generacion', []);
    await alcanzado;
    try {
      const where = { usuarioId_clave: { usuarioId: ids.a, clave: 'carrera_generacion' } };
      const original = await prisma.idempotenciaComentario.findUniqueOrThrow({ where });
      await prisma.idempotenciaComentario.update({ where, data: { expiraEn: new Date(0) } });
      await repo.limpiarVencidas();
      let llamadasNueva = 0;
      const sinFinalizar = new PrismaComentariosRepository({
        $transaction: (...args: Parameters<typeof prisma.$transaction>) => {
          if (++llamadasNueva === 2) return Promise.reject(new Error('finalización diferida'));
          return (prisma.$transaction as (...a: unknown[]) => unknown)(...args);
        },
      } as unknown as PrismaService);
      await sinFinalizar.crear(ids.tarea, ids.a, 'segunda generación', 'carrera_generacion', []);
      const reemplazo = await prisma.idempotenciaComentario.findUniqueOrThrow({ where });
      expect(reemplazo.generacion).not.toBe(original.generacion);
      liberar();
      await primera;
      const final = await prisma.idempotenciaComentario.findUniqueOrThrow({ where });
      expect(final.generacion).toBe(reemplazo.generacion);
      expect(final.expiraEn.getUTCFullYear()).toBe(9999);
    } finally { liberar(); await primera; }
  });
  it('serializa la limpieza y publicación concurrentes por la misma clave', async () => {
    const clave = 'race_limpieza';
    await repo.crear(ids.tarea, ids.a, 'contenido antiguo', clave, []);
    const where = { usuarioId_clave: { usuarioId: ids.a, clave } };
    await prisma.idempotenciaComentario.update({ where, data: { expiraEn: new Date(0) } });
    const barrera = new Client({ connectionString: dbUrl });
    await barrera.connect();
    try {
      const pid = (await barrera.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await barrera.query('BEGIN');
      await barrera.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([ids.a, clave])]);
      const limpieza = repo.limpiarVencidas();
      await esperarBloqueo('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$2 AND $1 = ANY(pg_blocking_pids(pid))) AS bloqueado', [pid, dbName]);
      const publicacion = repo.crear(ids.tarea, ids.a, 'contenido nuevo', clave, []);
      await esperarBloqueo('SELECT count(*) >= 2 AS bloqueado FROM pg_stat_activity WHERE datname=$2 AND $1 = ANY(pg_blocking_pids(pid))', [pid, dbName]);
      await barrera.query('COMMIT');
      await limpieza;
      const creada = await publicacion;
      expect(creada.replay).toBe(false);
      expect((await prisma.idempotenciaComentario.findUniqueOrThrow({ where })).comentarioId).toBe((creada.comentario as { id: string }).id);
    } finally { await barrera.query('ROLLBACK').catch(() => undefined); await barrera.end(); }
  }, 20000);
  it('conserva el 9999 legacy al convertirlo y falla cerrado ante clave anterior ausente', async () => {
    const texto = 'legacy indefinido';
    await repo.crear(ids.tarea, ids.a, texto, 'legacy_9999', []);
    const where = { usuarioId_clave: { usuarioId: ids.a, clave: 'legacy_9999' } };
    await prisma.idempotenciaComentario.update({ where, data: { huella: createHash('sha256').update(JSON.stringify([ids.tarea, texto])).digest('hex'), generacion: null, expiraEn: new Date('9999-12-31T23:59:59.000Z') } });
    await expect(repo.crear(ids.tarea, ids.a, 'diferente', 'legacy_9999', [])).rejects.toMatchObject({ status: 409 });
    expect((await repo.crear(ids.tarea, ids.a, texto, 'legacy_9999', [])).replay).toBe(true);
    expect((await prisma.idempotenciaComentario.findUniqueOrThrow({ where })).expiraEn.getUTCFullYear()).toBe(9999);
    const keys = process.env.COMENTARIOS_HMAC_CLAVES;
    const active = process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA;
    process.env.COMENTARIOS_HMAC_CLAVES = JSON.stringify({ rotada: randomBytes(32).toString('hex') });
    process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA = 'rotada';
    try {
      await expect(repo.crear(ids.tarea, ids.a, texto, 'legacy_9999', [])).rejects.toMatchObject({ status: 503 });
    } finally { process.env.COMENTARIOS_HMAC_CLAVES = keys; process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA = active; }
  });
  it('el borrado físico del autor elimina comentarios, menciones y avisos de terceros', async () => {
    const autor = await prisma.usuario.create({ data: { email: 'autor@test.invalid', nombre: 'Autor', passwordHash: 'hash' } });
    await prisma.membresia.create({ data: { usuarioId: autor.id, espacioId: ids.espacio } });
    const nuevo = await repo.crear(ids.tarea, autor.id, 'hola', 'autor', [ids.b]);
    const id = (nuevo.comentario as { id: string }).id;
    await prisma.usuario.delete({ where: { id: autor.id } });
    expect(await prisma.comentario.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.mencion.count({ where: { comentarioId: id } })).toBe(0);
    expect(await prisma.notificacion.count({ where: { comentarioId: id } })).toBe(0);
  });
  it('coordina borrado de proyecto con publicación pendiente', async () => {
    await prisma.proyecto.create({ data: { id: 'rf19_del_p', espacioId: ids.espacio, nombre: 'Eliminar' } });
    await prisma.tarea.create({ data: { id: 'rf19_del_t', proyectoId: 'rf19_del_p', titulo: 'Eliminar' } });
    const cliente = new Client({ connectionString: dbUrl }); await cliente.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('DELETE FROM "proyectos" WHERE id=$1', ['rf19_del_p']);
      const pendiente = repo.crear('rf19_del_t', ids.a, 'borrado', 'race_del', []);
      await new Promise(resolve => setTimeout(resolve, 100));
      await cliente.query('COMMIT');
      await expect(pendiente).rejects.toMatchObject({ status: 404 });
      expect(await prisma.idempotenciaComentario.count({ where: { clave: 'race_del' } })).toBe(0);
    } finally { await cliente.end(); }
  });
  it('borrar una tarea padre elimina comentarios y avisos de sus subtareas', async () => {
    await prisma.tarea.create({ data: { id: 'rf19_padre', proyectoId: ids.proyecto, titulo: 'Padre' } });
    await prisma.tarea.create({ data: { id: 'rf19_hija', proyectoId: ids.proyecto, tareaPadreId: 'rf19_padre', titulo: 'Hija' } });
    const c = await repo.crear('rf19_hija', ids.a, 'subtarea', 'subtarea', [ids.b]);
    const id = (c.comentario as { id: string }).id;
    await prisma.tarea.delete({ where: { id: 'rf19_padre' } });
    expect(await prisma.comentario.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.mencion.count({ where: { comentarioId: id } })).toBe(0);
    expect(await prisma.notificacion.count({ where: { comentarioId: id } })).toBe(0);
  });
  it('actualiza la ubicación del aviso al mover y conserva marcador tras cascada', async () => {
    await prisma.tarea.update({ where: { id: ids.tarea }, data: { proyectoId: ids.destino } });
    expect((await repo.notificaciones(ids.b, 1, 20)).datos[0]!.datos.proyectoId).toBe(ids.destino);
    await prisma.tarea.delete({ where: { id: ids.tarea } });
    expect(await prisma.comentario.count()).toBe(0);
    expect(await prisma.mencion.count()).toBe(0);
    expect(await prisma.notificacion.count({ where: { comentarioId: { not: null } } })).toBe(0);
    expect((await prisma.idempotenciaComentario.findFirst({ where: { clave: 'concurrente' } }))?.comentarioId).toBeNull();
    await expect(repo.crear(ids.tarea, ids.a, `@[${ids.a}] @[${ids.b}]`, 'concurrente', [ids.a, ids.b])).rejects.toMatchObject({ status: 404 });
  });
});
