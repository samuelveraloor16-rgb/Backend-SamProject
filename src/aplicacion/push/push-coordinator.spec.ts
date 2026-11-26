import { PushCoordinator } from './push-coordinator';

const ahora = new Date('2026-11-25T12:00:00Z');
function setup() {
  const detector = { ejecutar: jest.fn(async (_ahora: Date, _limite?: number, _cursor?: string) => ({ examinados: 0, encolados: 0, siguiente: null as string | null })) };
  const dispatcher = { despachar: jest.fn(async (_limite?: number) => 1) };
  const clock = jest.fn(() => ahora);
  const coordinator = new PushCoordinator(detector, dispatcher, e => e === 'transitorio', clock);
  return { detector, dispatcher, clock, coordinator };
}
describe('PushCoordinator invocable, sin scheduler ni I/O real', () => {
  it('pagina con instante fijo; siguiente barrido renueva instante y cursor', async () => {
    const { coordinator, detector, clock } = setup();
    detector.ejecutar.mockResolvedValueOnce({ examinados: 100, encolados: 1, siguiente: 'z' });
    await coordinator.ejecutar();
    clock.mockReturnValue(new Date(ahora.getTime() + 60000));
    await coordinator.ejecutar();
    await coordinator.ejecutar();
    expect(detector.ejecutar.mock.calls).toEqual([[ahora, 100, undefined], [ahora, 100, 'z'], [clock(), 100, undefined]]);
  });
  it('conflicto serializable repite misma página/instante incluso tras commits parciales', async () => {
    const { coordinator, detector } = setup();
    detector.ejecutar.mockRejectedValueOnce('transitorio').mockRejectedValueOnce('transitorio');
    expect(await coordinator.ejecutar()).toMatchObject({ deteccion: 'OK', despacho: 'OK' });
    expect(detector.ejecutar.mock.calls).toEqual(Array(3).fill([ahora, 100, undefined]));
  });
  it('agota tres intentos; conserva página y deja despachar lo confirmado', async () => {
    const { coordinator, detector, dispatcher } = setup();
    detector.ejecutar.mockRejectedValue('transitorio');
    expect(await coordinator.ejecutar()).toMatchObject({ deteccion: 'ERROR', despacho: 'OK' });
    expect(detector.ejecutar).toHaveBeenCalledTimes(3);
    detector.ejecutar.mockResolvedValue({ examinados: 0, encolados: 0, siguiente: null });
    await coordinator.ejecutar();
    expect(detector.ejecutar).toHaveBeenLastCalledWith(ahora, 100, undefined);
    expect(dispatcher.despachar).toHaveBeenCalledTimes(2);
  });
  it('error permanente no se reintenta; error de dispatcher no se reejecuta', async () => {
    const { coordinator, detector, dispatcher } = setup();
    detector.ejecutar.mockRejectedValue(new Error('privado'));
    dispatcher.despachar.mockRejectedValue(new Error('privado'));
    expect(await coordinator.ejecutar()).toEqual({ omitido: false, deteccion: 'ERROR', despacho: 'ERROR', procesadas: 0 });
    expect(detector.ejecutar).toHaveBeenCalledTimes(1);
    expect(dispatcher.despachar).toHaveBeenCalledTimes(1);
  });
  it('solapamiento local se omite y finalmente libera la guardia', async () => {
    const { coordinator, detector } = setup();
    let liberar!: () => void;
    detector.ejecutar.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { liberar = resolve; });
      return { examinados: 0, encolados: 0, siguiente: null };
    });
    const primero = coordinator.ejecutar();
    expect(await coordinator.ejecutar()).toEqual({ omitido: true });
    liberar(); await primero;
    expect(await coordinator.ejecutar()).toMatchObject({ omitido: false });
  });
  it('instancias independientes repiten barrido sin recrear identidades durables', async () => {
    const claves = new Set<string>();
    const detector = { ejecutar: jest.fn(async () => {
      const existia = claves.has('vencfin:t:u:fecha');
      claves.add('vencfin:t:u:fecha');
      return { examinados: 1, encolados: existia ? 0 : 1, siguiente: null };
    }) };
    const dispatcher = { despachar: jest.fn(async () => 0) };
    const a = new PushCoordinator(detector, dispatcher, () => false, () => ahora);
    const b = new PushCoordinator(detector, dispatcher, () => false, () => ahora);
    await Promise.all([a.ejecutar(), b.ejecutar()]);
    await a.ejecutar();
    expect(claves.size).toBe(1);
    // Doble de unicidad, no demostración de aislamiento PostgreSQL.
    expect(detector.ejecutar).toHaveBeenCalledTimes(3);
  });
});
