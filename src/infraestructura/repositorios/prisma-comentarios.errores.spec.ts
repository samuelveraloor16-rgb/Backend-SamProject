import { Prisma } from '@prisma/client';
import { PrismaComentariosRepository } from './prisma-comentarios.repository';
import type { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

describe('RF-19 traduce contención en todos sus casos de uso', () => {
  beforeAll(() => {
    process.env.COMENTARIOS_HMAC_CLAVES = JSON.stringify({ test: randomBytes(32).toString('hex') });
    process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA = 'test';
  });
  afterAll(() => { delete process.env.COMENTARIOS_HMAC_CLAVES; delete process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA; });
  const error = new Prisma.PrismaClientKnownRequestError('timeout', { code: 'P2024', clientVersion: 'test' });
  const db = { $transaction: jest.fn().mockRejectedValue(error), $executeRaw: jest.fn().mockResolvedValue(0) } as unknown as PrismaService;
  const repo = new PrismaComentariosRepository(db);
  it.each([
    () => repo.crear('t', 'u', 'hola', 'key', []),
    () => repo.listar('t', 'u', 1, 20),
    () => repo.directorio('t', 'u', 1, 20),
    () => repo.notificaciones('u', 1, 20),
    () => repo.leer('n', 'u'),
  ])('devuelve 503 al fallar la transacción', async operacion => {
    await expect(operacion()).rejects.toMatchObject({ status: 503 });
  });
});
