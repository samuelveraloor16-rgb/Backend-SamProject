import type { PushPayload, PushProvider, PushResultado } from '../../dominio/puertos/push-provider';

export type PushFetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'status' | 'json'>>;

/** Opt-in explícito: no usa fetch global ni credenciales por defecto. */
export class ExpoPushProvider implements PushProvider {
  constructor(private readonly request: PushFetch, private readonly config: { habilitado: boolean; accessToken?: string; timeoutMs?: number }) {}

  async enviar(payload: PushPayload): Promise<PushResultado> {
    if (!this.config.habilitado || !this.config.accessToken?.trim()) return 'SIN_CONFIGURACION';
    if (!/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(payload.to)) return 'TOKEN_INVALIDO';
    const controller = new AbortController();
    const timeout = Math.min(10000, Math.max(1, this.config.timeoutMs ?? 10000));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Promise.race también acota fetch inyectado que ignore AbortSignal.
      const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeout); });
      return await Promise.race([this.send(payload, controller.signal), expired]);
    } catch { return 'TRANSITORIO'; }
    finally { if (timer) clearTimeout(timer); }
  }

  private async send(payload: PushPayload, signal: AbortSignal): Promise<PushResultado> {
    const r = await this.request('https://exp.host/--/api/v2/push/send', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.accessToken}` },
      body: JSON.stringify(payload),
    });
    if (r.status === 429 || r.status >= 500) return 'TRANSITORIO';
    if (r.status < 200 || r.status >= 300) return 'DEFINITIVO';
    const body: unknown = await r.json();
    if (!body || typeof body !== 'object' || !('data' in body)) return 'TRANSITORIO';
    const data: unknown = body.data;
    if (!data || typeof data !== 'object' || !('status' in data)) return 'TRANSITORIO';
    if (data.status === 'ok' && 'id' in data && typeof data.id === 'string' && data.id) return 'ACEPTADO';
    if (data.status !== 'error') return 'TRANSITORIO';
    const details: unknown = 'details' in data ? data.details : null;
    const code = details && typeof details === 'object' && 'error' in details ? details.error : null;
    if (code === 'DeviceNotRegistered') return 'TOKEN_INVALIDO';
    if (code === 'MessageRateExceeded') return 'TRANSITORIO';
    return 'DEFINITIVO';
  }
}
