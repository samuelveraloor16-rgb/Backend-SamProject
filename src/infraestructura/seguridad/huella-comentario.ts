import { ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

const unavailable = () => new ServiceUnavailableException('Publicación temporalmente no disponible');
const idPattern = /^[A-Za-z0-9_-]{1,32}$/;
const hexPattern = /^[a-f0-9]{64}$/;

/** Configuración deliberadamente evaluada solo al publicar, nunca en lecturas. */
export function clavesComentario(): { activa: string; claves: Record<string, string> } {
  const activa = process.env.COMENTARIOS_HMAC_CLAVE_ACTIVA;
  let parsed: unknown;
  try { parsed = JSON.parse(process.env.COMENTARIOS_HMAC_CLAVES ?? ''); } catch { throw unavailable(); }
  if (!activa || !idPattern.test(activa) || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unavailable();
  const claves = parsed as Record<string, unknown>;
  for (const [id, value] of Object.entries(claves)) {
    if (!idPattern.test(id) || typeof value !== 'string' || !hexPattern.test(value)) throw unavailable();
  }
  if (!Object.hasOwn(claves, activa)) throw unavailable();
  return { activa, claves: claves as Record<string, string> };
}

const payload = (tareaId: string, texto: string) => JSON.stringify([tareaId, texto]);
function mac(clave: string, tareaId: string, texto: string): string {
  return createHmac('sha256', Buffer.from(clave, 'hex')).update('samproject/comentarios/v1\0').update(payload(tareaId, texto)).digest('hex');
}
function identificadorClave(clave: string): string {
  return createHmac('sha256', Buffer.from(clave, 'hex')).update('samproject/comentarios/key-check/v1').digest('hex');
}
function igual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
export function nuevaHuella(config: ReturnType<typeof clavesComentario>, tareaId: string, texto: string): string {
  const clave = config.claves[config.activa]!;
  return `hmac-sha256-v1:${config.activa}:${identificadorClave(clave)}:${mac(clave, tareaId, texto)}`;
}
export function verificarHuella(guardada: string, config: ReturnType<typeof clavesComentario>, tareaId: string, texto: string): { coincide: boolean; legacy: boolean } {
  let expected: string;
  const legacy = hexPattern.test(guardada);
  let actual = guardada;
  if (legacy) expected = createHash('sha256').update(payload(tareaId, texto)).digest('hex');
  else {
    const parts = guardada.split(':');
    if (parts.length !== 4 || parts[0] !== 'hmac-sha256-v1' || !idPattern.test(parts[1]!) || !hexPattern.test(parts[2]!) || !hexPattern.test(parts[3]!)) throw unavailable();
    const id = parts[1]!;
    if (!Object.hasOwn(config.claves, id)) throw unavailable();
    if (!igual(parts[2]!, identificadorClave(config.claves[id]!))) throw unavailable();
    expected = mac(config.claves[id]!, tareaId, texto);
    actual = parts[3]!;
  }
  return { coincide: igual(actual, expected), legacy };
}
