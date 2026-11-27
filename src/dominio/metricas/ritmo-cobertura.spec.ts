import { calcularRitmoSemanal, type HistorialSemanal } from './ritmo-semanal';

const fecha = (dia: string) => new Date(`${dia}T00:00:00.000Z`);
const corte = fecha('2026-11-23');
const dias = ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
function historial(cantidad: number, conteos = [1, 2, 3, 4]): HistorialSemanal {
  return { desde: fecha('2026-10-26'), coberturaAcreditada: true,
    grupos: dias.map((dia, i) => ({ inicio: fecha(dia), finalizaciones: conteos[i]! })),
    evidencia: { proyectoExistenteDesde: fecha('2026-10-01'),
      intervalos: cantidad ? [{ desde: fecha(dias[4 - cantidad]!), hasta: corte }] : [] } };
}

describe('RF22 promedio puro con evidencia sintética (no certifica cobertura real)', () => {
  it.each([[2, 7, 3.5], [3, 9, 3], [4, 10, 2.5]])('%i semanas verificadas', (n, total, promedio) => {
    expect(calcularRitmoSemanal(corte, historial(n))).toMatchObject({
      disponible: true, finalizaciones: total, semanasVerificadas: n, promedio,
    });
  });
  it('conserva fracción sin redondeo RF11', () => {
    expect(calcularRitmoSemanal(corte, historial(3, [100, 0, 0, 1])))
      .toMatchObject({ promedio: 1 / 3, finalizaciones: 1, semanasVerificadas: 3 });
  });
  it('cero es válido con >=2 semanas y no devuelve estimación', () => {
    const resultado = calcularRitmoSemanal(corte, historial(2, [0, 0, 0, 0]));
    expect(resultado).toMatchObject({ disponible: true, promedio: 0 });
    expect(resultado).not.toHaveProperty('estimacion');
  });
  it('sin grupos una semana verificada es cero, no las ausentes', () => {
    const h = historial(2); h.grupos = [];
    const r = calcularRitmoSemanal(corte, h);
    expect(r.disponible && r.semanas.map(s => s.finalizaciones)).toEqual([null, null, 0, 0]);
  });
  it.each([0, 1])('menos de dos verificadas: %i', n => {
    expect(calcularRitmoSemanal(corte, historial(n))).toEqual({ disponible: false,
      motivo: n === 0 ? 'COBERTURA_NO_ACREDITADA' : 'SEMANAS_VERIFICADAS_INSUFICIENTES' });
  });
  it('frontera, eventos o booleano legado no acreditan escritor antiguo/bypass', () => {
    const h = historial(4); delete h.evidencia;
    expect(calcularRitmoSemanal(corte, h)).toEqual({ disponible: false, motivo: 'COBERTURA_NO_ACREDITADA' });
  });
  it('semana parcialmente cubierta e interrupción de 1ms no son cero verificado', () => {
    const h = historial(4);
    h.evidencia!.intervalos = [
      { desde: fecha('2026-10-27'), hasta: fecha('2026-11-11') },
      { desde: new Date(fecha('2026-11-11').getTime() + 1), hasta: corte },
    ];
    const r = calcularRitmoSemanal(corte, h);
    expect(r.disponible && r.semanas.map(s => s.finalizaciones)).toEqual([null, 2, null, 4]);
    expect(r).toMatchObject({ promedio: 3, semanasVerificadas: 2 });
  });
  it('proyecto posterior al inicio no recibe existencia histórica ficticia', () => {
    const h = historial(4); h.evidencia!.proyectoExistenteDesde = fecha('2026-11-10');
    expect(calcularRitmoSemanal(corte, h)).toEqual({ disponible: false, motivo: 'SEMANAS_VERIFICADAS_INSUFICIENTES' });
  });
  it('omite actual incompleta y eventos fuera de ventana sin buscar anteriores', () => {
    const h = historial(4);
    h.grupos.push({ inicio: corte, finalizaciones: 999 }, { inicio: fecha('2026-10-19'), finalizaciones: 999 });
    for (const instante of [corte, new Date('2026-11-29T23:59:59.999Z')]) {
      expect(calcularRitmoSemanal(instante, h)).toMatchObject({ promedio: 2.5, finalizaciones: 10 });
    }
    const r = calcularRitmoSemanal(fecha('2026-11-30'), h);
    expect(r).toMatchObject({ semanasVerificadas: 3, finalizaciones: 9, promedio: 3 });
  });
});
