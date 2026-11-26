import { PushDispatcher } from './push-dispatcher';
import type { PushAlmacenado, PushOutboxRepository } from '../../dominio/puertos/push-outbox.repository';
import type { PushDispatchRepository, VinculoPush } from '../../dominio/puertos/push-dispatch.repository';
import type { PushPayload, PushProvider, PushResultado } from '../../dominio/puertos/push-provider';

const ahora = new Date('2026-11-25T12:00:00Z');
const fila: PushAlmacenado = { id: 'o', claveUnica: 'asig:t:1', usuarioId: 'u', tipo: 'TAREA_ASIGNADA', tareaId: 't', intentos: 0, proximoIntentoEn: ahora };
const vinculo: VinculoPush = { id: 'd', usuarioId: 'u', tokenPush: 'ExpoPushToken[mock]', tokenVersionVinculado: 0, actualizadoEn: ahora };
const payload: PushPayload = { to: vinculo.tokenPush, title: 'Tarea asignada', body: 'Se te asignó una tarea', data: { tipo: fila.tipo, tareaId: 't', proyectoId: 'p', espacioId: 'e', comentarioId: null } };
function setup(intentos = 0) {
  const actual = { ...fila, intentos };
  const outbox: PushOutboxRepository = { pendientes: jest.fn(async () => [actual]), encolar: jest.fn(), actualizar: jest.fn() };
  let claimed = false;
  const store: jest.Mocked<PushDispatchRepository> = {
    reclamar: jest.fn<ReturnType<PushDispatchRepository['reclamar']>, Parameters<PushDispatchRepository['reclamar']>>(async () => { if (claimed) return false; claimed = true; return true; }),
    dispositivos: jest.fn<ReturnType<PushDispatchRepository['dispositivos']>, Parameters<PushDispatchRepository['dispositivos']>>(async () => [vinculo]),
    revalidar: jest.fn<ReturnType<PushDispatchRepository['revalidar']>, Parameters<PushDispatchRepository['revalidar']>>(async () => payload),
    aceptado: jest.fn<ReturnType<PushDispatchRepository['aceptado']>, Parameters<PushDispatchRepository['aceptado']>>(async () => false),
    rechazado: jest.fn<ReturnType<PushDispatchRepository['rechazado']>, Parameters<PushDispatchRepository['rechazado']>>(async () => false),
    registrarRechazado: jest.fn(),
    registrarAceptado: jest.fn(), revocar: jest.fn(),
    finalizar: jest.fn<ReturnType<PushDispatchRepository['finalizar']>, Parameters<PushDispatchRepository['finalizar']>>(async () => true),
  };
  const provider: jest.Mocked<PushProvider> = { enviar: jest.fn<Promise<PushResultado>, [PushPayload]>(async () => 'ACEPTADO') };
  const warn = jest.fn();
  const dispatcher = new PushDispatcher(outbox, store, provider, warn, () => ahora);
  return { dispatcher, store, provider, warn, outbox };
}
describe('PushDispatcher invocable', () => {
  it('aceptación persiste journal y ENVIADO, no invoca negocio', async () => {
    const { dispatcher, store, provider, outbox } = setup();
    expect(await dispatcher.despachar()).toBe(1);
    expect(provider.enviar).toHaveBeenCalledWith(payload);
    expect(store.registrarAceptado).toHaveBeenCalledWith('o', vinculo);
    expect(store.finalizar).toHaveBeenCalledWith('o', 1, expect.objectContaining({ estado: 'ENVIADO', intentos: 1, enviadoEn: ahora }));
    expect(outbox.encolar).not.toHaveBeenCalled();
  });
  it.each(['revocación', 'transferencia', 'tokenVersion', 'acceso perdido'])('%s revalidado: cero envíos', async () => {
    const { dispatcher, store, provider } = setup();
    store.revalidar.mockResolvedValue(null);
    await dispatcher.despachar();
    expect(provider.enviar).not.toHaveBeenCalled();
    expect(store.finalizar).toHaveBeenCalledWith('o', 1, expect.objectContaining({ estado: 'DESCARTADO' }));
  });
  it('sin dispositivos descarta', async () => {
    const { dispatcher, store, provider } = setup();
    store.dispositivos.mockResolvedValue([]);
    await dispatcher.despachar();
    expect(provider.enviar).not.toHaveBeenCalled();
    expect(store.finalizar).toHaveBeenCalledWith('o', 1, expect.objectContaining({ estado: 'DESCARTADO' }));
  });
  it('token inválido limpia solo snapshot correspondiente', async () => {
    const { dispatcher, store, provider } = setup();
    provider.enviar.mockResolvedValue('TOKEN_INVALIDO');
    await dispatcher.despachar();
    expect(store.revocar).toHaveBeenCalledWith(vinculo);
    expect(store.finalizar).toHaveBeenCalledWith('o', 1, expect.objectContaining({ estado: 'DESCARTADO' }));
  });
  it.each(['transferencia', 'rotación', 'revinculación'] as const)('respuesta tardía tras %s no borra vínculo nuevo', async cambio => {
    const { dispatcher, store, provider } = setup();
    let actual = { ...vinculo };
    let resolver!: (r: PushResultado) => void;
    let iniciar!: () => void;
    const iniciado = new Promise<void>(resolve => { iniciar = resolve; });
    provider.enviar.mockImplementation(() => { iniciar(); return new Promise(resolve => { resolver = resolve; }); });
    // Simula el DELETE condicional del adaptador; el predicado SQL se prueba aparte.
    store.revocar.mockImplementation(async snapshot => {
      if (actual.usuarioId === snapshot.usuarioId && actual.tokenPush === snapshot.tokenPush && actual.tokenVersionVinculado === snapshot.tokenVersionVinculado && actual.actualizadoEn.getTime() === snapshot.actualizadoEn.getTime()) actual = null as never;
    });
    const trabajo = dispatcher.despachar();
    await iniciado;
    actual = { ...actual, actualizadoEn: new Date(ahora.getTime() + 1),
      ...(cambio === 'transferencia' ? { usuarioId: 'otra-cuenta' } : cambio === 'rotación' ? { tokenPush: 'ExpoPushToken[nuevo]' } : { tokenVersionVinculado: 1 }),
    };
    resolver('TOKEN_INVALIDO');
    await trabajo;
    expect(actual).not.toBeNull();
    expect(store.revocar).toHaveBeenCalledWith(vinculo);
  });
  it.each([0, 1, 2, 3])('transitorio: backoff exacto intento previo %i', async intentos => {
    const { dispatcher, store, provider } = setup(intentos);
    provider.enviar.mockResolvedValue('TRANSITORIO');
    await dispatcher.despachar();
    expect(store.finalizar).toHaveBeenCalledWith('o', intentos + 1, expect.objectContaining({ estado: 'PENDIENTE', proximoIntentoEn: new Date(ahora.getTime() + 60000 * 2 ** intentos) }));
  });
  it('quinto fallo es terminal', async () => {
    const { dispatcher, store, provider } = setup(4);
    provider.enviar.mockResolvedValue('TRANSITORIO');
    await dispatcher.despachar();
    expect(store.finalizar).toHaveBeenCalledWith('o', 5, expect.objectContaining({ estado: 'FALLIDO', intentos: 5 }));
  });
  it.each(['DEFINITIVO', 'SIN_CONFIGURACION'] as const)('%s sin borrar dispositivo', async result => {
    const { dispatcher, store, provider } = setup();
    provider.enviar.mockResolvedValue(result);
    await dispatcher.despachar();
    expect(store.revocar).not.toHaveBeenCalled();
    expect(store.finalizar).toHaveBeenCalledWith('o', 1, expect.objectContaining({ estado: result === 'DEFINITIVO' ? 'FALLIDO' : 'PENDIENTE' }));
  });
  it('límite de frecuencia no envía y reprograma', async () => {
    const { dispatcher, store, provider } = setup();
    store.revalidar.mockResolvedValue('LIMITADO');
    await dispatcher.despachar();
    expect(provider.enviar).not.toHaveBeenCalled();
    expect(store.finalizar).toHaveBeenCalledWith('o', 1, expect.objectContaining({ estado: 'PENDIENTE' }));
  });
  it('journal aceptado evita duplicar dispositivo en reintento parcial', async () => {
    const { dispatcher, store, provider } = setup(1);
    store.aceptado.mockResolvedValue(true);
    await dispatcher.despachar();
    expect(provider.enviar).not.toHaveBeenCalled();
    expect(store.finalizar).toHaveBeenCalledWith('o', 2, expect.objectContaining({ estado: 'ENVIADO' }));
  });
  it('fallo parcial: segundo despacho no reenvía al dispositivo ya aceptado', async () => {
    const { dispatcher, store, provider, outbox } = setup();
    const segundo = { ...vinculo, id: 'd2', tokenPush: 'ExpoPushToken[segundo]' };
    const aceptados = new Set<string>();
    store.dispositivos.mockResolvedValue([vinculo, segundo]);
    store.aceptado.mockImplementation(async (_, d) => aceptados.has(d.id));
    store.registrarAceptado.mockImplementation(async (_, d) => { aceptados.add(d.id); });
    store.revalidar.mockImplementation(async (_, d) => ({ ...payload, to: d.tokenPush }));
    provider.enviar.mockResolvedValueOnce('ACEPTADO').mockResolvedValueOnce('TRANSITORIO').mockResolvedValueOnce('ACEPTADO');
    await dispatcher.despachar();
    expect(aceptados).toEqual(new Set(['d']));
    (outbox.pendientes as jest.Mock).mockResolvedValue([{ ...fila, intentos: 1 }]);
    store.reclamar.mockResolvedValue(true);
    await dispatcher.despachar();
    expect(provider.enviar.mock.calls.map(([p]) => p.to)).toEqual([vinculo.tokenPush, segundo.tokenPush, segundo.tokenPush]);
    expect(aceptados).toEqual(new Set(['d', 'd2']));
    expect(store.finalizar).toHaveBeenLastCalledWith('o', 2, expect.objectContaining({ estado: 'ENVIADO' }));
  });
  it('rechazo definitivo previo no se reintenta por fallo de otro dispositivo', async () => {
    const { dispatcher, store, provider } = setup(1);
    store.rechazado.mockResolvedValue(true);
    await dispatcher.despachar();
    expect(provider.enviar).not.toHaveBeenCalled();
    expect(store.finalizar).toHaveBeenCalledWith('o', 2, expect.objectContaining({ estado: 'FALLIDO' }));
  });
  it('dos workers comparten claim CAS; solo uno envía', async () => {
    const { dispatcher, provider } = setup();
    await Promise.all([dispatcher.despachar(), dispatcher.despachar()]);
    expect(provider.enviar).toHaveBeenCalledTimes(1);
  });
  it('caída o error almacenamiento no filtra secretos ni propaga a negocio', async () => {
    const { dispatcher, store, warn } = setup();
    store.registrarAceptado.mockRejectedValue(new Error('TOKEN contenido contraseña'));
    await expect(dispatcher.despachar()).resolves.toBe(0);
    expect(warn.mock.calls).toEqual([['Push: no se pudo completar el despacho']]);
    expect(store.finalizar).not.toHaveBeenCalled();
  });
  it('revalida separadamente antes de cada dispositivo', async () => {
    const { dispatcher, store, provider } = setup();
    const segundo = { ...vinculo, id: 'd2' };
    store.dispositivos.mockResolvedValue([vinculo, segundo]);
    store.revalidar.mockResolvedValueOnce(payload).mockResolvedValueOnce(null);
    await dispatcher.despachar();
    expect(store.revalidar).toHaveBeenNthCalledWith(2, fila, segundo);
    expect(provider.enviar).toHaveBeenCalledTimes(1);
  });
});
