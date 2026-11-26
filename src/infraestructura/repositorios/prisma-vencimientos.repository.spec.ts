import { DetectorVencimientos } from '../../aplicacion/push/detector-vencimientos';
import type { CandidatoVencimiento } from '../../dominio/puertos/vencimientos.repository';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaVencimientosRepository } from './prisma-vencimientos.repository';

const ahora = new Date('2026-11-25T00:00:00.000Z');
const fecha = new Date('2026-11-26T00:00:00.000Z');
function setup() {
  const c: CandidatoVencimiento = { id: 't', responsableId: 'A', fechaLimite: fecha };
  const filas = new Map<string, unknown>();
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 't' }]),
    tarea: { findFirst: jest.fn(async () => ({ id: 't', fechaLimite: c.fechaLimite })), findMany: jest.fn(async () => [c]) },
    pushOutbox: { createMany: jest.fn(async ({ data }: { data: { claveUnica: string }[] }) => {
      const key = data[0]!.claveUnica;
      if (filas.has(key)) return { count: 0 };
      filas.set(key, data[0]); return { count: 1 };
    }) },
  };
  const db = { ...tx, $transaction: jest.fn(async (fn: (arg: typeof tx) => unknown) => fn(tx)) };
  const repo = new PrismaVencimientosRepository(db as unknown as PrismaService);
  return { c, filas, tx, repo, detector: new DetectorVencimientos(repo) };
}
describe('RF20 detector UTC sin BD ni proveedor (dobles)', () => {
  it.each([
    [-1, null], [0, 'venc24'], [1, 'venc24'], [86399999, 'venc24'], [86400000, 'vencfin'], [86400001, 'vencfin'],
  ])('límite UTC desplazamiento %i', async (delta, prefijo) => {
    const { repo, c, filas } = setup();
    expect(await repo.encolarVigente(c, new Date(ahora.getTime() + delta))).toBe(prefijo !== null);
    expect([...filas.keys()]).toEqual(prefijo ? [`${prefijo}:t:A:${fecha.toISOString()}`] : []);
  });
  it('ISO con offset representa el mismo instante UTC', async () => {
    const { detector, filas } = setup();
    await detector.ejecutar(new Date('2026-11-24T19:00:00-05:00'));
    expect([...filas.keys()]).toEqual([`venc24:t:A:${fecha.toISOString()}`]);
  });
  it('A→B→A y fecha nueva: solo identidades diferentes; concurrencia simulada', async () => {
    const { repo, c, filas, tx } = setup();
    const resultados = await Promise.all(Array.from({ length: 12 }, () => repo.encolarVigente(c, ahora)));
    expect(resultados.filter(Boolean)).toHaveLength(1);
    expect(await repo.encolarVigente({ ...c, responsableId: 'B' }, ahora)).toBe(true);
    expect(await repo.encolarVigente(c, ahora)).toBe(false);
    const nueva = new Date(fecha.getTime() - 1000);
    tx.tarea.findFirst.mockResolvedValue({ id: 't', fechaLimite: nueva });
    expect(await repo.encolarVigente({ ...c, fechaLimite: nueva }, ahora)).toBe(true);
    expect(filas.size).toBe(3);
    expect(tx.pushOutbox.createMany).toHaveBeenLastCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });
  it.each(['HECHA', 'archivado', 'eliminado', 'responsable cambiado', 'fecha cambiada', 'membresía revocada'])('%s entre escaneo y encolado: lectura actual filtra', async () => {
    const { c, repo, tx } = setup();
    tx.tarea.findFirst.mockResolvedValue(null as never);
    expect(await repo.encolarVigente(c, ahora)).toBe(false);
    expect(tx.pushOutbox.createMany).not.toHaveBeenCalled();
    expect(tx.tarea.findFirst).toHaveBeenCalledWith({ where: {
      id: 't', responsableId: 'A', fechaLimite: fecha, estado: { not: 'HECHA' },
      proyecto: { archivado: false, eliminadoEn: null, espacio: { membresias: { some: { usuarioId: 'A' } } } },
    }, select: { id: true, fechaLimite: true } });
  });
  it('join de locks ausente no permite insertar; locks cubren tarea/proyecto/membresía', async () => {
    const { repo, c, tx } = setup(); tx.$queryRaw.mockResolvedValue([]);
    expect(await repo.encolarVigente(c, ahora)).toBe(false);
    expect(tx.tarea.findFirst).not.toHaveBeenCalled();
    const strings = (tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0];
    expect(strings.join('?')).toContain('FOR SHARE OF t, p, m');
  });
  it('escaneo keyset acotado incluye subtareas sin filtro de padre', async () => {
    const { repo, tx } = setup(); await repo.candidatos(ahora, 'previo', 5);
    expect(tx.tarea.findMany).toHaveBeenCalledWith({ where: {
      id: { gt: 'previo' }, responsableId: { not: null }, estado: { not: 'HECHA' },
      fechaLimite: { lte: fecha }, proyecto: { archivado: false, eliminadoEn: null },
    }, select: { id: true, responsableId: true, fechaLimite: true }, orderBy: { id: 'asc' }, take: 5 });
  });
  it('progreso pese a duplicados: cursor por filas, segunda página subtarea', async () => {
    const { detector, tx, filas, c } = setup();
    tx.tarea.findMany.mockResolvedValueOnce([c]).mockResolvedValueOnce([{ ...c, id: 'subtarea' }]).mockResolvedValueOnce([]);
    await detector.ejecutar(ahora); // encola t
    tx.tarea.findMany.mockReset();
    tx.tarea.findMany.mockResolvedValueOnce([c]).mockResolvedValueOnce([{ ...c, id: 'subtarea' }]).mockResolvedValueOnce([]);
    const p1 = await detector.ejecutar(ahora, 1);
    expect(p1).toEqual({ examinados: 1, encolados: 0, siguiente: 't' });
    const p2 = await detector.ejecutar(ahora, 1, p1.siguiente!);
    expect(p2).toEqual({ examinados: 1, encolados: 1, siguiente: 'subtarea' });
    expect(await detector.ejecutar(ahora, 1, p2.siguiente!)).toEqual({ examinados: 0, encolados: 0, siguiente: null });
    expect(filas.size).toBe(2);
  });
  it('errores de transacción se propagan: reanudar mismo cursor es idempotente', async () => {
    const { detector, tx } = setup(); tx.pushOutbox.createMany.mockRejectedValueOnce(new Error('conflicto'));
    await expect(detector.ejecutar(ahora)).rejects.toThrow('conflicto');
    expect((await detector.ejecutar(ahora)).encolados).toBe(1);
  });
  it.each([0, 101, 1.5])('rechaza límite %s', async limite => {
    const { detector, tx } = setup(); await expect(detector.ejecutar(ahora, limite)).rejects.toThrow(RangeError);
    expect(tx.tarea.findMany).not.toHaveBeenCalled();
  });
  it('rechaza instante inválido', async () => {
    await expect(setup().detector.ejecutar(new Date(NaN))).rejects.toThrow(RangeError);
  });
});
