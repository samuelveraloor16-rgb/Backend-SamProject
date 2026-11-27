import { PrismaService } from '../prisma/prisma.service';
import { PrismaMetricasRepository } from './prisma-metricas.repository';
import { calcularRitmoSemanal, clasificarSemanas, lunesUtc } from '../../dominio/metricas/ritmo-semanal';

describe('RF22 lector semanal con dobles (NO acredita ejecución SQL ni concurrencia)', () => {
  const corte = new Date('2026-11-30T00:00:00Z');
  const evento = (fecha: string, tipo = 'FINALIZADA', contable = true, proyectoId = 'p1') => ({ ocurridoEn: new Date(fecha), tipo, contable, proyectoId });
  const eventos = [
    evento('2026-11-23T00:00:00Z'), // lunes, incluye
    evento('2026-11-29T23:59:59.999Z'), // domingo, incluye (recompletación)
    evento('2026-11-30T00:00:00Z'), // corte, excluye
    evento('2026-11-22T23:59:59.999Z'), // semana anterior
    evento('2026-11-24T00:00:00Z', 'REABIERTA'), // no resta
    evento('2026-11-24T00:00:00Z', 'FINALIZADA', false), // padre fotografía
    evento('2026-11-24T00:00:00Z', 'FINALIZADA', true, 'otro-espacio'),
    evento('2026-10-01T00:00:00Z'), // fuera ventana
  ];

  function preparar(visible = true, frontera: Date | null = new Date('2026-10-01T00:00:00Z')) {
    const findMany = jest.fn(async () => []); // tareas borradas/movidas: no afectan eventos
    const findUnique = jest.fn(async () => frontera ? { desde: frontera } : null);
    const query = jest.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const texto = sql.join('?');
      if (texto.includes('statement_timestamp')) return [{ corte }];
      // Verificación textual del SQL parametrizado y emulación, NO prueba SQL real.
      expect(texto).toContain('"tipo" = \'FINALIZADA\' AND "contable" = true');
      expect(texto).toContain('"ocurridoEn" >= ? AND "ocurridoEn" < ?');
      expect(texto).toContain("AT TIME ZONE 'UTC'");
      expect(texto).toContain('GROUP BY 1 ORDER BY 1 LIMIT 5');
      expect(texto).not.toMatch(/JOIN|tareaId/);
      expect(values).toEqual(['p1', new Date('2026-11-02T00:00:00Z'), corte]);
      const grupos = new Map<number, number>();
      for (const e of eventos) {
        if (e.proyectoId !== values[0] || e.tipo !== 'FINALIZADA' || !e.contable || e.ocurridoEn < (values[1] as Date) || e.ocurridoEn >= corte) continue;
        const semana = lunesUtc(e.ocurridoEn).getTime();
        grupos.set(semana, (grupos.get(semana) ?? 0) + 1);
      }
      return [...grupos].map(([inicio, finalizaciones]) => ({ inicio: new Date(inicio), finalizaciones }));
    });
    const tx = { $queryRaw: query, proyecto: { findFirst: jest.fn(async () => visible ? { id: 'p1' } : null) }, tarea: { findMany }, fronteraHistorialFinalizaciones: { findUnique } };
    const transaction = jest.fn(async (fn: (t: typeof tx) => unknown, options: unknown) => {
      expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
      return fn(tx);
    });
    return { repo: new PrismaMetricasRepository({ $transaction: transaction } as unknown as PrismaService), tx, transaction };
  }

  it('corte BD único y grupos RF11 fotografía independientes de población actual', async () => {
    const { repo, tx, transaction } = preparar();
    const resultado = await repo.leerInstantaneaVisible('p1', 'miembro');
    expect(resultado).toMatchObject({ calculadoEn: corte, contables: [], historial: { coberturaAcreditada: false } });
    expect(resultado!.historial.grupos).toEqual(expect.arrayContaining([
      { inicio: new Date('2026-11-23T00:00:00Z'), finalizaciones: 2 },
      { inicio: new Date('2026-11-16T00:00:00Z'), finalizaciones: 1 },
    ]));
    expect(clasificarSemanas(corte, resultado!.historial).every(s => s.finalizaciones === null)).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.tarea.findMany).toHaveBeenCalledTimes(1);
    expect(tx.fronteraHistorialFinalizaciones.findUnique).toHaveBeenCalledTimes(1);
  });
  it('no lee eventos/frontera/tareas sin autorización al proyecto', async () => {
    const { repo, tx } = preparar(false);
    expect(await repo.leerInstantaneaVisible('p1', 'ajeno')).toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // solo reloj, sin información del proyecto
    expect(tx.fronteraHistorialFinalizaciones.findUnique).not.toHaveBeenCalled();
    expect(tx.tarea.findMany).not.toHaveBeenCalled();
  });
  it('frontera ausente o fecha de migración antigua no acredita cobertura', async () => {
    for (const frontera of [null, new Date('2020-01-01T00:00:00Z')]) {
      const { repo } = preparar(true, frontera);
      const instantanea = (await repo.leerInstantaneaVisible('p1', 'admin'))!;
      expect(instantanea.historial.coberturaAcreditada).toBe(false);
      expect(instantanea.historial.evidencia).toBeNull();
      expect(calcularRitmoSemanal(instantanea.calculadoEn, instantanea.historial))
        .toEqual({ disponible: false, motivo: 'COBERTURA_NO_ACREDITADA' });
    }
  });
});
