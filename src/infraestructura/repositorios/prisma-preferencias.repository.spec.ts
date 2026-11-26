import { PrismaPreferenciasRepository } from './prisma-preferencias.repository';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('RF21 adaptador (dobles; no ejecuta SQL)', () => {
  it('upsert parametrizado actualiza solo canales enviados, orden fijo y lectura propia en transacción', async () => {
    const ejecutar = jest.fn().mockResolvedValue(1);
    const leer = jest.fn().mockResolvedValue([]);
    const tx = { $executeRaw: ejecutar, preferenciaNotificacion: { findMany: leer } };
    const transaction = jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    const repo = new PrismaPreferenciasRepository({ $transaction: transaction } as unknown as PrismaService);
    await repo.actualizar('u1', [{ tipo: 'MENCION', correo: true }, { tipo: 'COMENTARIO', push: false }]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    const consultas = ejecutar.mock.calls.map(call => call[0] as Prisma.Sql);
    expect(consultas[0]!.values).toContain('COMENTARIO');
    expect(consultas[0]!.text.split('DO UPDATE SET')[1]?.trim()).toBe('"push" = EXCLUDED."push"');
    expect(consultas[1]!.text.split('DO UPDATE SET')[1]?.trim()).toBe('"correo" = EXCLUDED."correo"');
    expect(consultas[1]!.values).toContain('u1');
    expect(consultas[1]!.values).toEqual(['u1', 'MENCION', true, true, true]);
    expect(leer).toHaveBeenCalledWith({ where: { usuarioId: 'u1' }, select: { tipo: true, inApp: true, correo: true, push: true } });
  });
  it('error de escritura propaga y no devuelve éxito ni lee matriz', async () => {
    const leer = jest.fn();
    const tx = { $executeRaw: jest.fn().mockRejectedValue(new Error('fallo SQL simulado')), preferenciaNotificacion: { findMany: leer } };
    const repo = new PrismaPreferenciasRepository({ $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaService);
    await expect(repo.actualizar('u1', [{ tipo: 'COMENTARIO', push: false }])).rejects.toThrow('fallo SQL simulado');
    expect(leer).not.toHaveBeenCalled();
  });
  it('migración offline contiene restricciones; inspección textual no acredita aplicación SQL', () => {
    const sql = readFileSync(join(process.cwd(), 'prisma/migrations/20261125180000_rf21_preferencias/migration.sql'), 'utf8');
    expect(sql).toContain('PRIMARY KEY ("usuarioId", "tipo")');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('CHECK ("tipo" <> \'MENCION\' OR "inApp" = true)');
    expect(sql).not.toMatch(/INVITACION|SISTEMA|INSERT INTO|ALTER TABLE/);
  });
});
