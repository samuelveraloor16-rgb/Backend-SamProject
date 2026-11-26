import nodemailer from 'nodemailer';
import type { CorreoEventosProvider, ResultadoCorreo } from '../../dominio/puertos/correo-eventos';

type Variables = Readonly<Record<string, string | undefined>>;
export function configuracionCorreo(env: Variables) {
  if (env.RF21_CORREO_ENABLED !== 'true') return null;
  const { RF21_SMTP_HOST: host, RF21_SMTP_PORT: puerto, RF21_SMTP_USER: user,
    RF21_SMTP_PASS: pass, RF21_SMTP_FROM: from, RF21_SMTP_TLS: modo } = env;
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || !puerto || !/^\d+$/.test(puerto)
    || !user?.trim() || !pass || !from || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)
    || !['IMPLICIT', 'STARTTLS'].includes(modo ?? '')) return null;
  const port = Number(puerto);
  if (port < 1 || port > 65535) return null;
  return { host, port, secure: modo === 'IMPLICIT', requireTLS: true,
    auth: { user, pass }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, from };
}

/** Clasificación conservadora. Solo respuestas estructuradas de comandos anteriores
 * a DATA o fallo inequívoco de conexión pueden demostrar rechazo previo. */
export function clasificarErrorCorreo(error: unknown): ResultadoCorreo {
  if (!error || typeof error !== 'object') return { estado: 'INCIERTO' };
  const e = error as { code?: unknown; command?: unknown; responseCode?: unknown };
  if (e.command === 'CONN' && ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(e.code))) {
    return { estado: 'RECHAZADO_PREVIO', transitorio: true };
  }
  if (['AUTH', 'MAIL FROM', 'RCPT TO', 'EHLO', 'HELO', 'STARTTLS'].includes(String(e.command))
    && typeof e.responseCode === 'number' && Number.isInteger(e.responseCode)
    && e.responseCode >= 400 && e.responseCode <= 599) {
    return { estado: 'RECHAZADO_PREVIO', transitorio: e.responseCode < 500 };
  }
  return { estado: 'INCIERTO' };
}

type Transporte = { sendMail: (mail: { from: string; to: string; subject: string; text: string }) => Promise<{ accepted?: unknown[] }> };
export class Rf21Smtp implements CorreoEventosProvider {
  constructor(private readonly variables: () => Variables = () => process.env,
    private readonly crear: (opciones: NonNullable<ReturnType<typeof configuracionCorreo>>) => Transporte = opciones => nodemailer.createTransport(opciones)) {}
  habilitado(): boolean { return configuracionCorreo(this.variables()) !== null; }
  async enviar(destino: string): Promise<ResultadoCorreo> {
    const config = configuracionCorreo(this.variables());
    // Si cambia configuración entre preparar y enviar no hubo I/O. No se
    // presenta como rechazo SMTP ni se reintenta automáticamente esa fase.
    if (!config || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(destino)) return { estado: 'INCIERTO' };
    try {
      const respuesta = await this.crear(config).sendMail({ from: config.from, to: destino,
        subject: 'Notificación de SamProject', text: 'Tienes un aviso. Consulta SamProject para ver los detalles.' });
      return respuesta.accepted?.length === 1 ? { estado: 'ACEPTADO' } : { estado: 'INCIERTO' };
    } catch (error) { return clasificarErrorCorreo(error); }
  }
}
