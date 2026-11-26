import { ExpoPushProvider, type PushFetch } from './expo-push.provider';
import type { PushPayload } from '../../dominio/puertos/push-provider';

const payload: PushPayload = { to: 'ExponentPushToken[test_only]', title: 'Tarea asignada', body: 'Se te asignó una tarea', data: { tipo: 'TAREA_ASIGNADA', tareaId: 't', proyectoId: 'p', espacioId: 'e', comentarioId: null } };
describe('ExpoPushProvider (solo fetch simulado)', () => {
  const setup = () => {
    const request = jest.fn<ReturnType<PushFetch>, Parameters<PushFetch>>();
    const provider = new ExpoPushProvider(request, { habilitado: true, accessToken: 'mock-only' });
    return { request, provider };
  };
  it('ticket aceptado no representa entrega; payload exacto mínimo', async () => {
    const { request, provider } = setup();
    request.mockResolvedValue({ status: 200, json: async () => ({ data: { status: 'ok', id: 'ticket' } }) });
    expect(await provider.enviar(payload)).toBe('ACEPTADO');
    expect(JSON.parse(request.mock.calls[0]![1].body as string)).toEqual(payload);
    expect(request.mock.calls[0]![0]).toBe('https://exp.host/--/api/v2/push/send');
  });
  it.each([429, 500, 503])('HTTP %i transitorio', async status => {
    const { request, provider } = setup();
    request.mockResolvedValue({ status, json: async () => ({}) });
    expect(await provider.enviar(payload)).toBe('TRANSITORIO');
  });
  it.each([400, 401, 403])('HTTP %i no limpia tokens', async status => {
    const { request, provider } = setup();
    request.mockResolvedValue({ status, json: async () => ({}) });
    expect(await provider.enviar(payload)).toBe('DEFINITIVO');
  });
  it.each([['DeviceNotRegistered', 'TOKEN_INVALIDO'], ['MessageRateExceeded', 'TRANSITORIO'], ['InvalidCredentials', 'DEFINITIVO'], ['MessageTooBig', 'DEFINITIVO']])('%s → %s', async (error, esperado) => {
    const { request, provider } = setup();
    request.mockResolvedValue({ status: 200, json: async () => ({ data: { status: 'error', details: { error } } }) });
    expect(await provider.enviar(payload)).toBe(esperado);
  });
  it('fallo de red sanitizado', async () => {
    const { request, provider } = setup();
    request.mockRejectedValue(new Error('token/contenido sensible'));
    expect(await provider.enviar(payload)).toBe('TRANSITORIO');
  });
  it('timeout aunque fetch ignore AbortSignal', async () => {
    jest.useFakeTimers();
    try {
      const request: PushFetch = () => new Promise(() => {});
      const result = new ExpoPushProvider(request, { habilitado: true, accessToken: 'mock', timeoutMs: 10 }).enviar(payload);
      await jest.advanceTimersByTimeAsync(10);
      expect(await result).toBe('TRANSITORIO');
    } finally { jest.useRealTimers(); }
  });
  it.each([{}, { habilitado: true }, { habilitado: false, accessToken: 'mock' }])('sin configuración no hace HTTP', async config => {
    const request = jest.fn();
    expect(await new ExpoPushProvider(request, { habilitado: false, ...config }).enviar(payload)).toBe('SIN_CONFIGURACION');
    expect(request).not.toHaveBeenCalled();
  });
  it('token malformado no hace HTTP', async () => {
    const { request, provider } = setup();
    expect(await provider.enviar({ ...payload, to: 'malformado' })).toBe('TOKEN_INVALIDO');
    expect(request).not.toHaveBeenCalled();
  });
  it.each([{}, { data: { status: 'ok' } }, { data: [] }])('respuesta incompleta no implica aceptación', async body => {
    const { request, provider } = setup();
    request.mockResolvedValue({ status: 200, json: async () => body });
    expect(await provider.enviar(payload)).toBe('TRANSITORIO');
  });
});
