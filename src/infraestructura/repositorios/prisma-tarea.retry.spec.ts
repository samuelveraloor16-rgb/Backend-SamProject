import { Prisma } from '@prisma/client';
import { PrismaTareaRepository } from './prisma-tarea.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('C-03 reintentos de ubicación', () => {
  function preparar(visible: boolean) {
    const query = jest.fn();
    const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Cada intento reproduce el mismo cambio concurrente, antes de escribir.
      query.mockReset();
      query.mockResolvedValueOnce([{ espacioId: 'e', archivado: false }])
        .mockResolvedValueOnce([{ espacioId: 'e', archivado: false }])
        .mockResolvedValueOnce([{ proyectoId: 'cambio', tareaPadreId: null }])
        .mockResolvedValueOnce([{ id: 'u' }])
        .mockResolvedValueOnce([{ usuarioId: 'u' }]);
      return fn({ tarea: { findUnique: jest.fn().mockResolvedValue({ proyectoId: 'p' }) }, $queryRaw: query });
    });
    const findFirst = jest.fn().mockResolvedValue(visible ? { id: 't' } : null);
    const repo = new PrismaTareaRepository({ $transaction: transaction, tarea: { findFirst } } as unknown as PrismaService);
    return { repo, transaction, findFirst };
  }

  it.each([[true, 503], [false, 404]])('agota tres intentos y reautoriza: visible=%s', async (visible, status) => {
    const { repo, transaction, findFirst } = preparar(visible);
    await expect(repo.moverConSubtareas('t', 'z', 'u')).rejects.toMatchObject({ status });
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('no reintenta un resultado transaccional ambiguo', async () => {
    const transaction = jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('timeout', { code: 'P2028', clientVersion: 'test' }));
    const repo = new PrismaTareaRepository({ $transaction: transaction } as unknown as PrismaService);
    await expect(repo.moverConSubtareas('t', 'z', 'u')).rejects.toMatchObject({ status: 503 });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('no revela el cambio de ubicación cuando la autorización falla', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ espacioId: 'e', archivado: false }])
      .mockResolvedValueOnce([{ espacioId: 'e', archivado: false }])
      .mockResolvedValueOnce([{ proyectoId: 'cambio', tareaPadreId: null }])
      .mockResolvedValueOnce([{ id: 'u' }])
      .mockResolvedValueOnce([]);
    const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ tarea: { findUnique: jest.fn().mockResolvedValue({ proyectoId: 'p' }) }, $queryRaw: query }));
    const repo = new PrismaTareaRepository({ $transaction: transaction } as unknown as PrismaService);
    await expect(repo.moverConSubtareas('t', 'z', 'u')).rejects.toMatchObject({ status: 404 });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
