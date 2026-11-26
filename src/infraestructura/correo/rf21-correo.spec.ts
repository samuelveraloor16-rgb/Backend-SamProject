import type { Prisma } from '@prisma/client';
import { CorreoDispatcher, siguienteCorreo } from '../../aplicacion/correo/correo-dispatcher';
import { SinEvidenciaCorreo } from '../../dominio/puertos/correo-eventos';
import type { CorreoDispatchRepository, EventoCorreo, ReservaCorreo } from '../../dominio/puertos/correo-eventos';
import { clasificarErrorCorreo, configuracionCorreo, Rf21Smtp } from './rf21-smtp';
import { finalizarIoCorreo, identidadCorreo, iniciarIoCorreo, recuperarIoCorreo, registrarCorreo } from './prisma-correo-outbox';

const env = { RF21_CORREO_ENABLED: 'true', RF21_SMTP_HOST: 'smtp.example.org', RF21_SMTP_PORT: '587',
  RF21_SMTP_USER: 'service', RF21_SMTP_PASS: 'test-only', RF21_SMTP_FROM: 'avisos@example.org', RF21_SMTP_TLS: 'STARTTLS' };
const evento: EventoCorreo = { claveUnica: 'com:c1:u1', usuarioId: 'u1', tareaId: 't1', comentarioId: 'c1',
  tipo: 'MENCION', ocurridoEn: new Date('2026-12-01T00:00:00Z') };
const reserva: ReservaCorreo = { digest: 'd', generacion: 'g', usuarioId: 'u1', intentos: 1 };
const txComo = (v: unknown) => v as Prisma.TransactionClient;

describe('RF21 correo: configuración y SMTP sin red', () => {
  it.each([undefined, 'false', 'TRUE', '1', ' true'])('default OFF exacttrue %s', async flag => {
    const crear = jest.fn();
    const proveedor = new Rf21Smtp(() => ({ ...env, RF21_CORREO_ENABLED: flag }), crear);
    expect(proveedor.habilitado()).toBe(false);
    await proveedor.enviar('current@example.org');
    expect(crear).not.toHaveBeenCalled();
  });
  it.each(['RF21_SMTP_HOST', 'RF21_SMTP_PORT', 'RF21_SMTP_USER', 'RF21_SMTP_PASS', 'RF21_SMTP_FROM', 'RF21_SMTP_TLS'])('sin %s no hay config', campo => {
    expect(configuracionCorreo({ ...env, [campo]: '' })).toBeNull();
  });
  it('TLS obligatorio con certificado; flags push no habilitan correo', () => {
    expect(configuracionCorreo(env)).toMatchObject({ secure: false, requireTLS: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } });
    expect(configuracionCorreo({ ...env, RF21_SMTP_TLS: 'IMPLICIT' })).toMatchObject({ secure: true });
    expect(configuracionCorreo({ EXPO_PUSH_ENABLED: 'true', PUSH_SCHEDULER_ENABLED: 'true' })).toBeNull();
    expect(configuracionCorreo({ ...env, RF21_SMTP_PORT: '65536' })).toBeNull();
  });
  it.each([{ code: 'ECONNRESET', command: 'DATA' }, { code: 'ETIMEDOUT', command: 'DATA' }, { responseCode: 451, command: 'DATA' }, {}, null])('ambiguo no retry %j', e => {
    expect(clasificarErrorCorreo(e)).toEqual({ estado: 'INCIERTO' });
  });
  it.each(['AUTH', 'MAIL FROM', 'RCPT TO', 'EHLO', 'STARTTLS'])('rechazos probados %s', command => {
    expect(clasificarErrorCorreo({ command, responseCode: 451 })).toEqual({ estado: 'RECHAZADO_PREVIO', transitorio: true });
    expect(clasificarErrorCorreo({ command, responseCode: 550 })).toEqual({ estado: 'RECHAZADO_PREVIO', transitorio: false });
  });
  it('fallo de conexión demostrado y mensaje sin datos del evento', async () => {
    expect(clasificarErrorCorreo({ command: 'CONN', code: 'ECONNREFUSED' })).toEqual({ estado: 'RECHAZADO_PREVIO', transitorio: true });
    const sendMail = jest.fn().mockResolvedValue({ accepted: ['current@example.org'] });
    const crear = jest.fn(() => ({ sendMail }));
    expect(await new Rf21Smtp(() => env, crear).enviar('current@example.org')).toEqual({ estado: 'ACEPTADO' });
    expect(sendMail.mock.calls[0][0]).toEqual({ from: env.RF21_SMTP_FROM, to: 'current@example.org',
      subject: 'Notificación de SamProject', text: 'Tienes un aviso. Consulta SamProject para ver los detalles.' });
  });
});

describe('RF21 correo: identidad y cutover offline', () => {
  function fixture() {
    const identidades = new Set<string>();
    const tx = {
      identidadCorreo: { createMany: jest.fn(async ({ data }: { data: { digest: string }[] }) => {
        const digest = data[0]!.digest;
        const nuevo = !identidades.has(digest); identidades.add(digest); return { count: Number(nuevo) };
      }) },
      fronteraCorreo: { findUnique: jest.fn().mockResolvedValue({ desde: new Date('2026-11-30T00:00:00Z') }) },
      preferenciaNotificacion: { findUnique: jest.fn().mockResolvedValue({ correo: true }) },
      correoOutbox: { create: jest.fn() },
    };
    return tx;
  }
  it('identidad propia independiente de tipo; borrado/replay no recrea', async () => {
    const tx = fixture();
    expect(await registrarCorreo(txComo(tx), evento)).toBe(true);
    tx.correoOutbox.create.mockClear(); // simula desaparición de payload, no tombstone
    expect(await registrarCorreo(txComo(tx), { ...evento, tipo: 'COMENTARIO' })).toBe(false);
    expect(tx.correoOutbox.create).not.toHaveBeenCalled();
    expect(identidadCorreo(evento)).not.toContain('u1');
  });
  it.each([null, { correo: false }])('suprimido consume identidad aun habilitado después', async preferencia => {
    const tx = fixture(); tx.preferenciaNotificacion.findUnique.mockResolvedValue(preferencia);
    expect(await registrarCorreo(txComo(tx), evento)).toBe(false);
    tx.preferenciaNotificacion.findUnique.mockResolvedValue({ correo: true });
    expect(await registrarCorreo(txComo(tx), evento)).toBe(false);
    expect(tx.correoOutbox.create).not.toHaveBeenCalled();
  });
  it('evento anterior a frontera no usa instante de escaneo ni backfill', async () => {
    const tx = fixture();
    expect(await registrarCorreo(txComo(tx), { ...evento, ocurridoEn: new Date('2020-01-01Z') })).toBe(false);
    expect(tx.correoOutbox.create).not.toHaveBeenCalled();
  });
  it('frontera ausente o fallo persistencia propaga a transacción caller', async () => {
    const tx = fixture(); tx.fronteraCorreo.findUnique.mockResolvedValue(null);
    await expect(registrarCorreo(txComo(tx), evento)).rejects.toThrow('Frontera');
    const otro = fixture(); otro.correoOutbox.create.mockRejectedValue(new Error('storage'));
    await expect(registrarCorreo(txComo(otro), evento)).rejects.toThrow('storage');
  });
  it('no snapshot de dirección ni contenido; identidad diferente por usuario', async () => {
    const tx = fixture(); await registrarCorreo(txComo(tx), evento);
    expect(Object.keys(tx.correoOutbox.create.mock.calls[0][0].data).sort()).toEqual(['comentarioId','digest','ocurridoEn','tareaId','tipo','usuarioId']);
    expect(identidadCorreo(evento)).not.toBe(identidadCorreo({ ...evento, usuarioId: 'u2' }));
  });
});

describe('RF21 correo: fase durable, presupuesto y fencing (dobles)', () => {
  it('inicial más cinco retries, no seis retries', () => {
    for (let n = 1; n <= 5; n++) expect(siguienteCorreo(n, { estado: 'RECHAZADO_PREVIO', transitorio: true }))
      .toEqual({ estado: 'PENDIENTE', esperaMs: 60000 * 2 ** (n - 1) });
    expect(siguienteCorreo(6, { estado: 'RECHAZADO_PREVIO', transitorio: true }).estado).toBe('FALLIDO');
    expect(siguienteCorreo(1, { estado: 'INCIERTO' }).estado).toBe('INCIERTO');
    expect(siguienteCorreo(1, { estado: 'RECHAZADO_PREVIO', transitorio: false }).estado).toBe('FALLIDO');
  });
  it('SQL claim usa relojBD y presupuesto; recuperación no vuelve pendiente; CAS tardío falla', async () => {
    const query = jest.fn().mockResolvedValue([reserva]); const execute = jest.fn().mockResolvedValue(0);
    const tx = txComo({ $queryRaw: query, $executeRaw: execute });
    expect(await iniciarIoCorreo(tx, 'd', 'g')).toEqual(reserva);
    expect(query.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    const sql = query.mock.calls[1][0].join('?');
    expect(sql).toContain('clock_timestamp()'); expect(sql).toContain('"intentos" < 6');
    await recuperarIoCorreo(tx);
    expect(execute.mock.calls[0][0].join('?')).toContain("SET \"estado\" = 'INCIERTO'");
    expect(await finalizarIoCorreo(tx, reserva, { estado: 'ACEPTADO' })).toBe(false);
    expect(execute.mock.calls[1][0].join('?')).toContain('"leaseHasta" > clock_timestamp()');
    expect(execute.mock.calls[1][0].join('?')).toContain('"generacion" = ?');
  });
  function setup() {
    let enIo = false;
    const repo: CorreoDispatchRepository = {
      recuperar: jest.fn(async () => {}), candidatos: jest.fn(async () => ['d']),
      preparar: jest.fn(async (_digest, evidencia) => {
        if (!await evidencia.acredita('u1', 'current@example.org') || enIo) return null;
        enIo = true; return { ...reserva, direccion: 'current@example.org' };
      }), finalizar: jest.fn(async () => {}),
    };
    const proveedor = { habilitado: jest.fn(() => true), enviar: jest.fn(async () => ({ estado: 'ACEPTADO' as const })) };
    return { repo, proveedor };
  }
  it('adaptador actual sin evidencia zeroSend; no presupuesto consumido', async () => {
    const { repo, proveedor } = setup();
    await new CorreoDispatcher(repo, proveedor, new SinEvidenciaCorreo()).ejecutar();
    expect(proveedor.enviar).not.toHaveBeenCalled(); expect(repo.finalizar).not.toHaveBeenCalled();
  });
  it('proveedor OFF no toca storage ni evidencia', async () => {
    const { repo, proveedor } = setup(); proveedor.habilitado.mockReturnValue(false);
    await new CorreoDispatcher(repo, proveedor, new SinEvidenciaCorreo()).ejecutar();
    expect(repo.recuperar).not.toHaveBeenCalled();
  });
  it('aceptación + crash persistencia no provoca segundo I/O al reiniciar', async () => {
    const { repo, proveedor } = setup();
    (repo.finalizar as jest.Mock).mockRejectedValueOnce(new Error('crash'));
    const evidencia = { acredita: jest.fn(async () => true) };
    await expect(new CorreoDispatcher(repo, proveedor, evidencia).ejecutar()).rejects.toThrow('crash');
    await new CorreoDispatcher(repo, proveedor, evidencia).ejecutar();
    expect(proveedor.enviar).toHaveBeenCalledTimes(1);
    expect(evidencia.acredita).toHaveBeenCalledWith('u1', 'current@example.org');
  });
  it('concurrentes comparten CAS de reserva; excepción externa es incierta', async () => {
    const { repo, proveedor } = setup(); proveedor.enviar.mockRejectedValue(new Error('reset DATA'));
    const evidencia = { acredita: jest.fn(async () => true) };
    await Promise.all([new CorreoDispatcher(repo, proveedor, evidencia).ejecutar(), new CorreoDispatcher(repo, proveedor, evidencia).ejecutar()]);
    expect(proveedor.enviar).toHaveBeenCalledTimes(1);
    expect(repo.finalizar).toHaveBeenCalledWith(expect.anything(), { estado: 'INCIERTO' });
  });
});
