import { PrismaPushDispatchRepository } from './prisma-push-dispatch.repository';
import { PrismaService } from '../prisma/prisma.service';
import type { PushAlmacenado } from '../../dominio/puertos/push-outbox.repository';
import type { VinculoPush } from '../../dominio/puertos/push-dispatch.repository';

const ahora = new Date('2026-11-25T12:00:00Z');
const v: VinculoPush = { id: 'd', usuarioId: 'u', tokenPush: 'ExpoPushToken[mock]', tokenVersionVinculado: 2, actualizadoEn: ahora };
const f: PushAlmacenado = { id: 'o', usuarioId: 'u', tipo: 'TAREA_ASIGNADA', claveUnica: 'asig:t:1', tareaId: 't', intentos: 0, proximoIntentoEn: ahora };
function setup() {
  const tarea = { proyectoId: 'p', responsableId: 'u', estado: 'PENDIENTE', fechaLimite: ahora, proyecto: { espacioId: 'e', archivado: false } };
  const tx = {
    preferenciaNotificacion: { findUnique: jest.fn(async (): Promise<{ push: boolean } | null> => null) },
    $queryRaw: jest.fn(async () => [{ ahora }]),
    pushOutbox: { count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 1 })), findFirst: jest.fn(async () => ({ id: 'o' })) },
    dispositivo: { findFirst: jest.fn(async () => ({ usuario: { tokenVersion: 2 } })), findMany: jest.fn(async () => [v]), deleteMany: jest.fn(async () => ({ count: 1 })) },
    tarea: { findFirst: jest.fn(async () => tarea) },
    comentario: { findFirst: jest.fn(async () => ({ menciones: [{ usuarioId: 'u' }] })) },
    pushIntento: { count: jest.fn(async () => 0), create: jest.fn(), updateMany: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const db = { ...tx, $transaction: jest.fn(async (fn: (arg: typeof tx) => unknown) => fn(tx)) };
  const repo = new PrismaPushDispatchRepository(db as unknown as PrismaService);
  return { repo, tx, db, tarea };
}
describe('PrismaPushDispatchRepository sin PostgreSQL', () => {
  it.each(['TAREA_ASIGNADA', 'TAREA_POR_VENCER', 'TAREA_VENCIDA', 'COMENTARIO', 'MENCION'] as const)('silencia %s antes de reserva sin fallback', async tipo => {
    const { repo, tx } = setup();
    tx.preferenciaNotificacion.findUnique.mockResolvedValue({ push: false });
    expect(await repo.revalidar({ ...f, tipo }, v)).toBeNull();
    expect(tx.preferenciaNotificacion.findUnique).toHaveBeenCalledWith({ where: { usuarioId_tipo: { usuarioId: 'u', tipo } }, select: { push: true } });
    expect(tx.pushIntento.create).not.toHaveBeenCalled();
    expect(tx.comentario.findFirst).not.toHaveBeenCalled();
  });
  it('relee preferencia entre dispositivos y reintentos; fallo BD no autoriza', async () => {
    const { repo, tx } = setup();
    expect(await repo.revalidar(f, v)).not.toBeNull();
    tx.preferenciaNotificacion.findUnique.mockResolvedValue({ push: false });
    expect(await repo.revalidar(f, { ...v, id: 'd2' })).toBeNull();
    expect(await repo.revalidar({ ...f, intentos: 1 }, v)).toBeNull();
    tx.preferenciaNotificacion.findUnique.mockRejectedValue(new Error('offline'));
    await expect(repo.revalidar(f, v)).rejects.toThrow('offline');
    expect(tx.pushIntento.create).toHaveBeenCalledTimes(1);
  });
  it('claim CAS con lease e incremento, serializa destinatario', async () => {
    const { repo, tx } = setup();
    expect(await repo.reclamar(f, ahora)).toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.pushOutbox.updateMany).toHaveBeenCalledWith({ where: { id: 'o', estado: 'PENDIENTE', intentos: 0, proximoIntentoEn: { lte: ahora } }, data: { intentos: { increment: 1 }, proximoIntentoEn: new Date(ahora.getTime() + 120000) } });
  });
  it('CAS perdido no reclama', async () => {
    const { repo, tx } = setup(); tx.pushOutbox.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.reclamar(f, ahora)).toBe(false);
  });
  it('claim usa reloj BD, no el reloj adelantado del proceso', async () => {
    const { repo, tx } = setup();
    await repo.reclamar(f, new Date(ahora.getTime() + 3600000));
    expect(tx.pushOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ proximoIntentoEn: { lte: ahora } }),
      data: { intentos: { increment: 1 }, proximoIntentoEn: new Date(ahora.getTime() + 120000) },
    }));
  });
  it('terminalización de quinto intento no pisa un lease todavía vigente', async () => {
    const { repo, tx } = setup();
    await repo.reclamar({ ...f, intentos: 5 }, ahora);
    expect(tx.pushOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'o', estado: 'PENDIENTE', intentos: 5, proximoIntentoEn: { lte: ahora } }, data: { estado: 'FALLIDO' },
    });
  });
  it('trabajo en vuelo mismo destinatario bloquea otro claim', async () => {
    const { repo, tx } = setup(); tx.pushOutbox.count.mockResolvedValue(1);
    expect(await repo.reclamar(f, ahora)).toBe(false);
    expect(tx.pushOutbox.updateMany).not.toHaveBeenCalled();
  });
  it('crash en quinto intento: terminal, no sexto envío', async () => {
    const { repo, tx } = setup();
    expect(await repo.reclamar({ ...f, intentos: 5 }, ahora)).toBe(false);
    expect(tx.pushOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { estado: 'FALLIDO' } }));
  });
  it('payload exacto y reserva 10/min transaccional sin contenido', async () => {
    const { repo, tx } = setup();
    expect(await repo.revalidar(f, v)).toEqual({ to: v.tokenPush, title: 'Tarea asignada', body: 'Se te asignó una tarea', data: { tipo: f.tipo, tareaId: 't', proyectoId: 'p', espacioId: 'e', comentarioId: null } });
    expect(tx.pushIntento.create).toHaveBeenCalledWith({ data: { outboxId: 'o', dispositivoId: 'd', usuarioId: 'u', vinculoEn: ahora, creadoEn: ahora } });
    expect(tx.tarea.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't', proyecto: { eliminadoEn: null, espacio: { membresias: { some: { usuarioId: 'u' } } } } } }));
  });
  it('usuario incorrecto rechaza antes de leer token', async () => {
    const { repo, db } = setup();
    expect(await repo.revalidar(f, { ...v, usuarioId: 'otro' })).toBeNull();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('revocado, transferido o generación rotada no resuelve snapshot', async () => {
    const { repo, tx } = setup(); tx.dispositivo.findFirst.mockResolvedValue(null as never);
    expect(await repo.revalidar(f, v)).toBeNull();
    expect(tx.dispositivo.findFirst).toHaveBeenCalledWith({ where: v, select: { usuario: { select: { tokenVersion: true } } } });
    expect(tx.pushIntento.create).not.toHaveBeenCalled();
  });
  it('tokenVersion invalidado descarta', async () => {
    const { repo, tx } = setup(); tx.dispositivo.findFirst.mockResolvedValue({ usuario: { tokenVersion: 3 } });
    expect(await repo.revalidar(f, v)).toBeNull();
    expect(tx.tarea.findFirst).not.toHaveBeenCalled();
  });
  it('lease caducado o intento reclamado por otro worker no envía', async () => {
    const { repo, tx } = setup(); tx.pushOutbox.findFirst.mockResolvedValue(null as never);
    expect(await repo.revalidar(f, v)).toBeNull();
    expect(tx.dispositivo.findFirst).not.toHaveBeenCalled();
  });
  it('pérdida de acceso a tarea/espacio descarta', async () => {
    const { repo, tx } = setup(); tx.tarea.findFirst.mockResolvedValue(null as never);
    expect(await repo.revalidar(f, v)).toBeNull();
  });
  it('asignación atrasada ya no responsable descarta', async () => {
    const { repo, tarea } = setup(); tarea.responsableId = 'otro';
    expect(await repo.revalidar(f, v)).toBeNull();
  });
  it('archivado no recibe recordatorios', async () => {
    const { repo, tarea } = setup(); tarea.proyecto.archivado = true;
    expect(await repo.revalidar(f, v)).toBeNull();
  });
  it.each(['TAREA_POR_VENCER', 'TAREA_VENCIDA'] as const)('%s fecha actual y ventana UTC', async tipo => {
    const { repo, tarea } = setup();
    const prefijo = tipo === 'TAREA_POR_VENCER' ? 'venc24' : 'vencfin';
    tarea.fechaLimite = new Date(ahora.getTime() + (tipo === 'TAREA_POR_VENCER' ? 86400000 : 0));
    const evento = { ...f, tipo, claveUnica: `${prefijo}:t:u:${tarea.fechaLimite.toISOString()}` };
    expect(await repo.revalidar(evento, v)).not.toBeNull();
    tarea.estado = 'HECHA';
    expect(await repo.revalidar(evento, v)).toBeNull();
    tarea.estado = 'PENDIENTE'; tarea.fechaLimite = new Date(ahora.getTime() + 172800000);
    expect(await repo.revalidar(evento, v)).toBeNull();
  });
  it.each(['TAREA_POR_VENCER', 'TAREA_VENCIDA'] as const)('%s legacy sin usuario falla cerrado', async tipo => {
    const { repo, tx } = setup();
    const prefijo = tipo === 'TAREA_POR_VENCER' ? 'venc24' : 'vencfin';
    expect(await repo.revalidar({ ...f, tipo, claveUnica: `${prefijo}:t:${ahora.toISOString()}` }, v)).toBeNull();
    expect(tx.pushIntento.create).not.toHaveBeenCalled();
  });
  it('24h expira al llegar fecha; al vencer no dispara un ms antes', async () => {
    const { repo, tarea, tx } = setup();
    const evento = { ...f, tipo: 'TAREA_POR_VENCER' as const, claveUnica: `venc24:t:u:${ahora.toISOString()}` };
    expect(await repo.revalidar(evento, v)).toBeNull();
    tarea.fechaLimite = new Date(ahora.getTime() + 1);
    expect(await repo.revalidar({ ...evento, tipo: 'TAREA_VENCIDA', claveUnica: `vencfin:t:u:${tarea.fechaLimite.toISOString()}` }, v)).toBeNull();
    expect(tx.pushIntento.create).not.toHaveBeenCalled();
  });
  it('vencimiento cambia responsable o fecha después de encolar: no reserva I/O', async () => {
    const { repo, tarea, tx } = setup();
    const evento = { ...f, tipo: 'TAREA_VENCIDA' as const, claveUnica: `vencfin:t:u:${ahora.toISOString()}` };
    tarea.responsableId = 'B';
    expect(await repo.revalidar(evento, v)).toBeNull();
    tarea.responsableId = 'u'; tarea.fechaLimite = new Date(ahora.getTime() - 1);
    expect(await repo.revalidar(evento, v)).toBeNull();
    expect(tx.pushIntento.create).not.toHaveBeenCalled();
  });
  it('comentario desaparecido no envía', async () => {
    const { repo, tx } = setup(); tx.comentario.findFirst.mockResolvedValue(null as never);
    expect(await repo.revalidar({ ...f, tipo: 'MENCION', comentarioId: 'c' }, v)).toBeNull();
    expect(tx.comentario.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c', tareaId: 't', autorId: { not: 'u' } } }));
  });
  it('mención ya no elegible no envía', async () => {
    const { repo, tx } = setup(); tx.comentario.findFirst.mockResolvedValue({ menciones: [] });
    expect(await repo.revalidar({ ...f, tipo: 'MENCION', comentarioId: 'c' }, v)).toBeNull();
  });
  it('responsable comentario debe seguir siendo responsable', async () => {
    const { repo, tarea } = setup(); tarea.responsableId = 'otro';
    expect(await repo.revalidar({ ...f, tipo: 'COMENTARIO', comentarioId: 'c' }, v)).toBeNull();
  });
  it('frecuencia no reserva ni entrega el onceavo', async () => {
    const { repo, tx } = setup(); tx.pushIntento.count.mockResolvedValue(10);
    expect(await repo.revalidar(f, v)).toBe('LIMITADO');
    expect(tx.pushIntento.create).not.toHaveBeenCalled();
  });
  it('respuesta inválida tardía: borrado condicional incluye dueño/token/version/generación', async () => {
    const { repo, tx } = setup();
    await repo.revocar(v);
    expect(tx.dispositivo.deleteMany).toHaveBeenCalledWith({ where: v });
  });
  it('refrescar vínculo no duplica un evento ya aceptado para dispositivo/cuenta', async () => {
    const { repo, tx } = setup(); tx.pushIntento.count.mockResolvedValue(1);
    expect(await repo.aceptado('o', { ...v, actualizadoEn: new Date(ahora.getTime() + 1) })).toBe(true);
    expect(tx.pushIntento.count).toHaveBeenCalledWith({ where: { outboxId: 'o', dispositivoId: 'd', usuarioId: 'u', aceptado: true } });
  });
  it('aceptación tardía solo registra generación vieja sin actualizar vínculo', async () => {
    const { repo, tx } = setup();
    await repo.registrarAceptado('o', v);
    expect(tx.pushIntento.updateMany).toHaveBeenCalledWith({ where: { outboxId: 'o', dispositivoId: 'd', usuarioId: 'u', vinculoEn: ahora }, data: { aceptado: true } });
    const [strings, ...values] = tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('AND "actualizadoEn" =');
    expect(values).toEqual(['d', 'u', v.tokenPush, 2, ahora]);
  });
  it('finalización de worker viejo no pisa nuevo intento', async () => {
    const { repo, tx } = setup(); tx.pushOutbox.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.finalizar('o', 1, { estado: 'ENVIADO', intentos: 1 })).toBe(false);
    expect(tx.pushOutbox.updateMany).toHaveBeenCalledWith({ where: { id: 'o', estado: 'PENDIENTE', intentos: 1 }, data: { estado: 'ENVIADO', intentos: 1 } });
  });
});
