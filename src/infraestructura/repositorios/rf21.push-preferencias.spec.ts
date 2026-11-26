import { PrismaPushOutboxRepository } from './prisma-push-outbox.repository';
import { PrismaService } from '../prisma/prisma.service';
import { TIPOS_PREFERENCIA } from '../../dominio/puertos/preferencias.repository';

describe('RF21 preferencias push al encolar offline', () => {
  function setup() {
    const db = {
      preferenciaNotificacion: { findUnique: jest.fn(async (): Promise<{ push: boolean } | null> => null) },
      pushOutbox: { createMany: jest.fn(async () => ({ count: 1 })) },
    };
    return { db, repo: new PrismaPushOutboxRepository(db as unknown as PrismaService) };
  }
  it.each(TIPOS_PREFERENCIA)('default %s activo y false solo su destinatario/tipo', async tipo => {
    const { db, repo } = setup();
    const evento = { tipo, usuarioId: 'u', tareaId: 't', claveUnica: 'evento' };
    expect(await repo.encolar(evento)).toBe(true);
    db.preferenciaNotificacion.findUnique.mockResolvedValue({ push: false });
    expect(await repo.encolar(evento)).toBe(false);
    expect(db.pushOutbox.createMany).toHaveBeenCalledTimes(1);
    expect(db.preferenciaNotificacion.findUnique).toHaveBeenLastCalledWith({ where: { usuarioId_tipo: { usuarioId: 'u', tipo } }, select: { push: true } });
  });
  it('fallo de lectura no inserta ni permite envío', async () => {
    const { db, repo } = setup();
    db.preferenciaNotificacion.findUnique.mockRejectedValue(new Error('offline'));
    await expect(repo.encolar({ tipo: 'MENCION', usuarioId: 'u', tareaId: 't', claveUnica: 'com:c:u' })).rejects.toThrow('offline');
    expect(db.pushOutbox.createMany).not.toHaveBeenCalled();
  });
});
