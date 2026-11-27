import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import type { Readable } from 'node:stream';
import PdfPrinter from 'pdfmake/js/Printer';
import type { ReporteResumenRenderer, ResumenIdentificado, FormatoReporte } from '../../dominio/puertos/reporte-resumen.renderer';
import { MAX_REPORTE_BYTES } from '../../aplicacion/reportes/reportes.service';
import { verificarGlifos } from './fuente';

export const COLUMNAS_RESUMEN = ['proyectoId', 'proyectoNombre', 'calculadoEn', 'progreso', 'total', 'hechas', 'pendientes', 'enCurso', 'trabajoPendiente', 'vencidas', 'ritmoDisponible', 'ritmoMotivo', 'ritmoPromedioSemanal'] as const;

export function textoCsv(texto: string): string {
  // Espacios Unicode y controles/formato invisibles no permiten ocultar el operador.
  const peligro = /^[\p{White_Space}\p{Cc}\p{Cf}]*[=+@-]/u.test(texto) || /^[\p{Cc}\p{Cf}]/u.test(texto);
  return `"${(peligro ? "'" + texto : texto).replace(/"/g, '""')}"`;
}

export async function acumularAcotado(stream: Readable, limite = MAX_REPORTE_BYTES): Promise<Buffer> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of stream) {
    const buffer = Buffer.isBuffer(parte) ? parte : Buffer.from(parte as Uint8Array);
    total += buffer.length;
    if (total > limite) {
      stream.destroy();
      throw new UnprocessableEntityException('Contenido del reporte excede los límites');
    }
    partes.push(buffer);
  }
  return Buffer.concat(partes, total);
}

@Injectable()
export class ResumenRenderer implements ReporteResumenRenderer {
  async generar(resumen: ResumenIdentificado, formato: FormatoReporte): Promise<Buffer> {
    const { proyecto, metricas: m } = resumen;
    // La rama disponible interna RF22 no es un contrato público exportable.
    if (m.ritmo.disponible) throw new Error('Ritmo público no admitido');
    const valores = [proyecto.id, proyecto.nombre, m.calculadoEn.toISOString(), m.progreso, m.total,
      m.hechas, m.pendientes, m.enCurso, m.trabajoPendiente, m.vencidas, 'NO_DISPONIBLE', m.ritmo.motivo, ''];
    if (formato === 'csv') {
      return Buffer.from('\uFEFF' + COLUMNAS_RESUMEN.join(',') + '\r\n' + valores.map(v => typeof v === 'number' ? String(v) : textoCsv(v)).join(',') + '\r\n', 'utf8');
    }
    const fuente = readFileSync(require.resolve('pdfmake/fonts/Roboto/Roboto-Regular.ttf'));
    const filas = COLUMNAS_RESUMEN.map((campo, i) => `${campo}: ${valores[i]}`);
    const titulo = 'Resumen del proyecto';
    verificarGlifos(fuente, [titulo, ...filas].join('\n'));
    // Instancia por solicitud; buffers de fuente, no singleton pdfmake ni rutas del usuario.
    // Resolver y acceso local cerrados incluso si un cambio accidental introduce recursos.
    const printer = new PdfPrinter({ Roboto: { normal: fuente } }, undefined,
      { resolve: resource => { if (resource !== undefined && !Buffer.isBuffer(resource)) throw new Error('Recursos externos prohibidos'); }, resolved: async () => {} }, () => false);
    const doc = await printer.createPdfKitDocument({
      pageSize: 'A4', pageMargins: 40, defaultStyle: { font: 'Roboto', fontSize: 11 },
      content: [{ text: titulo, fontSize: 18, margin: [0, 0, 0, 16] }, ...filas.map(text => ({ text, margin: [0, 0, 0, 8] }))],
    });
    const resultado = acumularAcotado(doc);
    doc.end();
    return resultado;
  }
}
