import { clasificarSemanas, inicioVentanaSemanal, lunesUtc, ritmoNoDisponible } from './ritmo-semanal';

const corte = new Date('2026-11-26T12:00:00.000Z');
const desde = new Date('2026-10-26T00:00:00.000Z');

describe('RF22 calendario y clasificación interna (sin promedio inventado)', () => {
  it.each([
    ['2026-11-23T00:00:00.000Z', '2026-11-23'],
    ['2026-11-29T23:59:59.999Z', '2026-11-23'],
    ['2026-11-30T00:00:00.000Z', '2026-11-30'],
  ])('lunes UTC %s', (instante, esperado) => {
    expect(lunesUtc(new Date(instante)).toISOString()).toBe(`${esperado}T00:00:00.000Z`);
  });
  it('ventana fija cuatro cerradas más actual incompleta, incluso exactamente lunes', () => {
    expect(inicioVentanaSemanal(corte)).toEqual(desde);
    for (const instante of [corte, new Date('2026-11-23T00:00:00Z')]) {
      const semanas = clasificarSemanas(instante, { desde, coberturaAcreditada: true, grupos: [] });
      expect(semanas).toHaveLength(5);
      expect(semanas.slice(0, 4).map(s => s.finalizaciones)).toEqual([0, 0, 0, 0]);
      expect(semanas[4]).toMatchObject({ cerrada: false, estado: 'INCOMPLETA', finalizaciones: null });
    }
  });
  it.each([0, 1, 2, 3, 4, 8])('%i semanas observadas: no rellena anteriores con cero, recorta >4', cantidad => {
    const frontera = new Date(Date.parse('2026-11-23T00:00:00Z') - cantidad * 604800000);
    const semanas = clasificarSemanas(corte, { desde: frontera, coberturaAcreditada: true, grupos: [] });
    expect(semanas.filter(s => s.estado === 'COMPLETA')).toHaveLength(Math.min(cantidad, 4));
    expect(semanas.filter(s => s.estado === 'SIN_DATOS').every(s => s.finalizaciones === null)).toBe(true);
  });
  it('frontera mitad de semana deja parcial, no cero ni semana completa', () => {
    const semanas = clasificarSemanas(corte, { desde: new Date('2026-11-11T12:00:00Z'), coberturaAcreditada: true, grupos: [] });
    expect(semanas.map(s => s.estado)).toEqual(['SIN_DATOS', 'SIN_DATOS', 'PARCIAL', 'COMPLETA', 'INCOMPLETA']);
    expect(semanas[2]!.finalizaciones).toBeNull();
  });
  it.each([null, desde])('sin frontera o sin acreditación no publica observación %s', frontera => {
    for (const coberturaAcreditada of [false, ...(frontera === null ? [true] : [])]) {
      const semanas = clasificarSemanas(corte, { desde: frontera, coberturaAcreditada, grupos: [{ inicio: desde, finalizaciones: 50 }] });
      expect(semanas.every(s => s.estado === 'SIN_EVIDENCIA' && s.finalizaciones === null)).toBe(true);
    }
    expect(ritmoNoDisponible()).toEqual({ disponible: false, motivo: 'COBERTURA_NO_ACREDITADA' });
  });
  it('grupos ya filtrados solo alimentan semanas completas, vacío observado es cero', () => {
    const semanas = clasificarSemanas(corte, { desde, coberturaAcreditada: true, grupos: [
      { inicio: desde, finalizaciones: 3 },
      { inicio: new Date('2026-11-23T00:00:00Z'), finalizaciones: 99 },
    ] });
    expect(semanas.map(s => s.finalizaciones)).toEqual([3, 0, 0, 0, null]);
  });
});
