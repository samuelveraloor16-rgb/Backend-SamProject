import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { conErroresTransitorios, esErrorTransitorio } from './errores-transitorios';

const conocido = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError('mensaje', { code, clientVersion: 'test', meta });

describe('errores transitorios de Prisma y PostgreSQL', () => {
  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034', 'P2037'])('mapea %s a 503', async code => {
    await expect(conErroresTransitorios(async () => { throw conocido(code); })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it.each(['40001', '40P01', '55P03', '57014', '53300', '57P01', '57P02', '57P03'])('mapea SQLSTATE %s en causa del adaptador', async code => {
    const error = conocido('P2010', { driverAdapterError: { cause: { originalCode: code } } });
    await expect(conErroresTransitorios(async () => { throw error; })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('identifica un conflicto de escritura sin SQLSTATE', () => {
    expect(esErrorTransitorio(conocido('P2010', { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } }))).toBe(true);
  });
  it('conserva errores de negocio, unicidad y SQL ajeno', async () => {
    for (const error of [new BadRequestException(), conocido('P2002'), conocido('P2010', { code: '23503' })]) {
      await expect(conErroresTransitorios(async () => { throw error; })).rejects.toBe(error);
    }
  });
});
