import { randomBytes } from 'crypto';
import { basename, resolve } from 'path';
import { Client } from 'pg';
import { ConfigService } from '@nestjs/config';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { AuthService, sha256Hex } from '../../aplicacion/auth/auth.service';
import { USUARIO_REPOSITORY } from '../../dominio/puertos/usuario.repository';
import { MAILER } from '../../dominio/puertos/mailer.port';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaUsuarioRepository } from './prisma-usuario.repository';
import { BcryptPasswordHasher } from '../seguridad/bcrypt-password-hasher';

const integration = process.env.RF03_INTEGRATION === '1' ? describe : describe.skip;
integration('RF-03 consumo único PostgreSQL y HTTP', () => {
  let prisma: PrismaService;
  let repo: PrismaUsuarioRepository;
  let app: INestApplication;
  const ids = [0, 1, 2, 3, 4, 5, 6].map(i => `rf03_${randomBytes(12).toString('hex')}_${i}`);
  const token = () => randomBytes(32).toString('hex');
  const hasher = new BcryptPasswordHasher();
  async function conLimite<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tiempo de prueba agotado')), ms);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async function crear(id: string, t: string) {
    await prisma.usuario.create({ data: { id, email: `${id}@example.invalid`, nombre: 'Prueba', passwordHash: await hasher.hash('Inicial123!'), resetTokenHash: sha256Hex(t), resetTokenExpires: new Date(Date.now() + 60000) } });
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    const expected = process.env.RF03_PG_DATA;
    if (!url || !expected || !/^sam-rf03-[a-zA-Z0-9]+$/.test(basename(resolve(expected, '..')))) {
      throw new Error('Se requiere clúster efímero RF-03 explícito');
    }
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/postgres') throw new Error('Destino inseguro');
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      const identity = await client.query<{ data_directory: string }>('SHOW data_directory');
      if (resolve(identity.rows[0]!.data_directory).toLowerCase() !== resolve(expected).toLowerCase()) throw new Error('Clúster incorrecto');
    } finally { await client.end(); }
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await prisma.$connect();
    repo = new PrismaUsuarioRepository(prisma);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(USUARIO_REPOSITORY).useValue(repo)
      .overrideProvider(MAILER).useValue({ enviar: async () => true }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (prisma) await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it('acepta token válido una vez, rechaza usado y vencido sin efectos', async () => {
    const valid = token(); const expired = token();
    const initial = await hasher.hash('Inicial123!');
    await prisma.usuario.createMany({ data: [
      { id: ids[0]!, email: `${ids[0]}@example.invalid`, nombre: 'Prueba', passwordHash: initial, resetTokenHash: sha256Hex(valid), resetTokenExpires: new Date(Date.now() + 60000) },
      { id: ids[1]!, email: `${ids[1]}@example.invalid`, nombre: 'Prueba', passwordHash: initial, resetTokenHash: sha256Hex(expired), resetTokenExpires: new Date(Date.now() - 60000) },
    ] });
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const jwt = app.get(JwtService).sign({ sub: ids[0], tokenVersion: 0 });
    await request(server).get('/api/v1/perfil').auth(jwt, { type: 'bearer' }).expect(200);
    const send = (t: string) => request(server).post('/api/v1/auth/restablecer').send({ token: t, contrasenaNueva: 'Nueva123!' });
    await send(valid).expect(200);
    const used = await send(valid).expect(400);
    const vencido = await send(expired).expect(400);
    expect(used.body.message).toEqual(vencido.body.message);
    await request(server).get('/api/v1/perfil').auth(jwt, { type: 'bearer' }).expect(401);
    const actual = await prisma.usuario.findUniqueOrThrow({ where: { id: ids[0]! } });
    const sinCambios = await prisma.usuario.findUniqueOrThrow({ where: { id: ids[1]! } });
    expect(await hasher.comparar('Nueva123!', actual.passwordHash)).toBe(true);
    expect(actual).toMatchObject({ tokenVersion: 1, resetTokenHash: null, resetTokenExpires: null });
    expect(sinCambios).toMatchObject({ tokenVersion: 0, passwordHash: initial, resetTokenHash: sha256Hex(expired) });
  }, 30000);

  it('serializa dos HTTP con ambas lecturas válidas antes de escribir', async () => {
    const t = token();
    await crear(ids[2]!, t);
    const anterior = app.get(JwtService).sign({ sub: ids[2], tokenVersion: 0 });
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    let liberar!: () => void;
    const barrera = new Promise<void>(resolve => { liberar = resolve; });
    let lecturas = 0; let escrituras = 0;
    const original = repo.buscarPorResetTokenHash.bind(repo);
    const readSpy = jest.spyOn(repo, 'buscarPorResetTokenHash').mockImplementation(async hash => {
      const usuario = await original(hash);
      expect(usuario).not.toBeNull();
      if (++lecturas === 2) liberar();
      await barrera;
      return usuario;
    });
    const write = repo.restablecerPassword.bind(repo);
    const writeSpy = jest.spyOn(repo, 'restablecerPassword').mockImplementation(async (...args) => {
      expect(lecturas).toBe(2);
      escrituras++;
      return write(...args);
    });
    const passwords = ['Primera123!', 'Segunda456!'];
    let vencioBarrera = false;
    const timer = setTimeout(() => { vencioBarrera = true; liberar(); }, 6000);
    const pendientes = passwords.map(contrasenaNueva => Promise.resolve(
      request(server).post('/api/v1/auth/restablecer').send({ token: t, contrasenaNueva }).timeout({ deadline: 8000 })));
    const terminados = Promise.allSettled(pendientes);
    try {
      const resultados = await conLimite(terminados, 10000);
      expect(vencioBarrera).toBe(false);
      expect(resultados.every(r => r.status === 'fulfilled')).toBe(true);
      const respuestas = resultados.map(r => {
        if (r.status === 'rejected') throw r.reason as Error;
        return r.value;
      });
      expect(respuestas.map(r => r.status).sort()).toEqual([200, 400]);
      expect(lecturas).toBe(2); expect(escrituras).toBe(2);
      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: ids[2]! } });
      const coincide = await Promise.all(passwords.map(p => hasher.comparar(p, usuario.passwordHash)));
      expect(coincide.filter(Boolean)).toHaveLength(1);
      expect(coincide[respuestas.findIndex(r => r.status === 200)]).toBe(true);
      expect(usuario).toMatchObject({ tokenVersion: 1, resetTokenHash: null, resetTokenExpires: null });
      await request(server).get('/api/v1/perfil').auth(anterior, { type: 'bearer' }).expect(401);
      const nuevo = app.get(JwtService).sign({ sub: ids[2], tokenVersion: 1 });
      await request(server).get('/api/v1/perfil').auth(nuevo, { type: 'bearer' }).expect(200);
    } finally {
      clearTimeout(timer); liberar();
      try { await conLimite(terminados, 10000); }
      finally { readSpy.mockRestore(); writeSpy.mockRestore(); }
    }
  }, 30000);

  it('rechaza un token que vence mientras espera el bloqueo de fila', async () => {
    const t = token(); const id = ids[5]!;
    await crear(id, t);
    const cliente = new Client({ connectionString: process.env.DATABASE_URL });
    let pendiente: Promise<PromiseSettledResult<unknown>[]> | undefined;
    await cliente.connect();
    try {
      await cliente.query(`UPDATE usuarios SET "resetTokenExpires" = date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') + interval '3 seconds' WHERE id = $1`, [id]);
      const antes = await prisma.usuario.findUniqueOrThrow({ where: { id } });
      await cliente.query('BEGIN');
      await cliente.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
      const pid = (await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const vigente = await cliente.query<{ vigente: boolean }>(`SELECT "resetTokenExpires" >= date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS vigente FROM usuarios WHERE id=$1`, [id]);
      expect(vigente.rows[0]!.vigente).toBe(true);
      pendiente = Promise.allSettled([app.get(AuthService).restablecer({ token: t, contrasenaNueva: 'Nueva123!' })]);
      const limite = Date.now() + 2000;
      let bloqueado = false;
      while (Date.now() < limite) {
        const r = await cliente.query<{ espera: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS espera', [pid]);
        if (r.rows[0]!.espera) { bloqueado = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(bloqueado).toBe(true);
      // El tiempo transcurre realmente en PostgreSQL; no se modifica el vencimiento durante la espera.
      await cliente.query(`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM ("resetTokenExpires" - (clock_timestamp() AT TIME ZONE 'UTC'))) + 0.05)) FROM usuarios WHERE id=$1`, [id]);
      await cliente.query('COMMIT');
      const resultado = (await conLimite(pendiente, 8000))[0]!;
      expect(resultado.status).toBe('rejected');
      if (resultado.status === 'rejected') expect(resultado.reason).toMatchObject({ status: 400, message: 'El enlace es inválido o ha caducado' });
      expect(await prisma.usuario.findUniqueOrThrow({ where: { id } })).toEqual(antes);
    } finally {
      try { await cliente.query('ROLLBACK').catch(() => undefined); }
      finally {
        try { if (pendiente) await conLimite(pendiente, 8000); }
        finally { await cliente.end(); }
      }
    }
  }, 20000);

  it.each(['vencido', 'sustituido'])('rechaza token %s después de la lectura', async cambio => {
      const id = cambio === 'vencido' ? ids[3]! : ids[6]!;
      await crear(id, token());
      const t = token();
      const reemplazo = sha256Hex(token());
      await prisma.usuario.update({ where: { id }, data: { resetTokenHash: sha256Hex(t), resetTokenExpires: new Date(Date.now() + 60000) } });
      const antes = await prisma.usuario.findUniqueOrThrow({ where: { id } });
      const write = repo.restablecerPassword.bind(repo);
      const spy = jest.spyOn(repo, 'restablecerPassword').mockImplementation(async (...args) => {
        await prisma.usuario.update({ where: { id }, data: cambio === 'vencido'
          ? { resetTokenExpires: new Date(0) } : { resetTokenHash: reemplazo } });
        return write(...args);
      });
      try {
        await expect(app.get(AuthService).restablecer({ token: t, contrasenaNueva: 'Nueva123!' }))
          .rejects.toMatchObject({ status: 400, message: 'El enlace es inválido o ha caducado' });
        const despues = await prisma.usuario.findUniqueOrThrow({ where: { id } });
        expect(despues.passwordHash).toBe(antes.passwordHash);
        expect(despues.tokenVersion).toBe(antes.tokenVersion);
        expect(despues.resetTokenHash).toBe(cambio === 'vencido' ? sha256Hex(t) : reemplazo);
      } finally { spy.mockRestore(); }
  }, 30000);

  it('revierte íntegramente el update si PostgreSQL rechaza la escritura', async () => {
    const t = token(); const hash = sha256Hex(t); const expira = new Date(Date.now() + 60000);
    await crear(ids[4]!, t);
    await prisma.usuario.update({ where: { id: ids[4]! }, data: { resetTokenHash: hash, resetTokenExpires: expira } });
    const antes = await prisma.usuario.findUniqueOrThrow({ where: { id: ids[4]! } });
    await prisma.$executeRawUnsafe("CREATE FUNCTION rf03_rechazar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo sintético'; END $$");
    try {
      await prisma.$executeRawUnsafe('CREATE TRIGGER rf03_rechazar BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION rf03_rechazar()');
      await expect(repo.restablecerPassword(ids[4]!, hash, 'hash-sintetico')).rejects.toThrow();
      expect(await prisma.usuario.findUniqueOrThrow({ where: { id: ids[4]! } })).toEqual(antes);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS rf03_rechazar ON usuarios');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS rf03_rechazar()');
    }
  });
});
