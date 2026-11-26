import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PushCoordinator } from '../../aplicacion/push/push-coordinator';
import { PushPersistenceModule } from '../repositorios/push-persistence.module';
import { PushSchedulingModule } from './push-scheduling.module';

@Module({ providers: [{ provide: PushCoordinator, useValue: {} }], exports: [PushCoordinator] })
class OfflinePersistenceModule {}

describe('Programación RF20 con ScheduleModule real, sin Prisma/I/O', () => {
  let app: TestingModule;
  let enabled: unknown;
  const detector = { ejecutar: jest.fn() };
  const dispatcher = { despachar: jest.fn() };
  let warn: jest.SpyInstance;

  async function start() {
    const coordinator = new PushCoordinator(detector, dispatcher, () => false);
    app = await Test.createTestingModule({ imports: [PushSchedulingModule] })
      .overrideModule(PushPersistenceModule).useModule(OfflinePersistenceModule)
      .overrideProvider(PushCoordinator).useValue(coordinator)
      .overrideProvider(ConfigService).useValue({ get: () => enabled }).compile();
    await app.init();
    return coordinator;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    enabled = undefined;
    detector.ejecutar.mockResolvedValue({ examinados: 0, encolados: 0, siguiente: null });
    dispatcher.despachar.mockResolvedValue(0);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await app?.close();
    warn.mockRestore();
    jest.useRealTimers();
  });

  it.each([undefined, 'false', 'TRUE', '1', true])('opt-in estricto: %s no ejecuta', async value => {
    enabled = value;
    await start();
    expect(app.get(SchedulerRegistry).getIntervals()).toEqual(['rf20-push']);
    await jest.advanceTimersByTimeAsync(180_000);
    expect(detector.ejecutar).not.toHaveBeenCalled();
    expect(dispatcher.despachar).not.toHaveBeenCalled();
  });

  it('no ejecuta en arranque, ejecuta un lote/minuto y se detiene al cerrar', async () => {
    enabled = 'true';
    await start();
    expect(detector.ejecutar).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(detector.ejecutar).toHaveBeenCalledTimes(2);
    expect(dispatcher.despachar).toHaveBeenCalledWith(100);
    await app.close();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(detector.ejecutar).toHaveBeenCalledTimes(2);
  });

  it('omite ticks y llamadas manuales solapadas; libera guardia tras fallo', async () => {
    enabled = 'true';
    let reject!: (reason: Error) => void;
    detector.ejecutar.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    const coordinator = await start();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(detector.ejecutar).toHaveBeenCalledTimes(1);
    expect(await coordinator.ejecutar()).toEqual({ omitido: true });
    reject(new Error('SECRET token SQL'));
    await jest.advanceTimersByTimeAsync(60_000);
    expect(detector.ejecutar).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    expect(warn).toHaveBeenCalled();
  });

  it('captura rechazo inesperado sin exponer error y continúa siguiente tick', async () => {
    enabled = 'true';
    const coordinator = await start();
    jest.spyOn(coordinator, 'ejecutar').mockRejectedValueOnce(new Error('SECRET'));
    await jest.advanceTimersByTimeAsync(120_000);
    expect(warn).toHaveBeenCalledWith('RF20: fallo de programación periódica');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    expect(dispatcher.despachar).toHaveBeenCalledTimes(1);
  });

  it('reinicio vuelve al inicio sin pedir limpieza ni borrar identidades', async () => {
    enabled = 'true';
    const keys = new Set<string>();
    detector.ejecutar.mockImplementation(async () => {
      keys.add('identidad-durable');
      return { examinados: 1, encolados: 0, siguiente: 'cursor' };
    });
    await start();
    await jest.advanceTimersByTimeAsync(60_000);
    await app.close();
    await start();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(detector.ejecutar.mock.calls.map(call => call[2])).toEqual([undefined, undefined]);
    expect(keys.size).toBe(1);
    // También tras 90 días: el scheduler solo coordina, no tiene puerto de borrado.
    enabled = 'false';
    await jest.advanceTimersByTimeAsync(90 * 86_400_000);
    expect(keys.size).toBe(1);
    expect(detector.ejecutar).toHaveBeenCalledTimes(2);
  });
});
