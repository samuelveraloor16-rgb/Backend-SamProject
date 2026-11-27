// Parser independiente de pruebas; stdin binario, sin disco, red ni render canvas.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const loading = getDocument({ data: new Uint8Array(Buffer.concat(chunks)),
  useSystemFonts: false, isEvalSupported: false, disableFontFace: true });
const doc = await loading.promise;
const pages = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  const ops = await page.getOperatorList();
  const fonts = Object.values(content.styles).map(style => style.fontFamily);
  pages.push({ text: content.items.map(item => item.str ?? '').join('\n'), fonts, operators: ops.fnArray.length });
}
process.stdout.write(JSON.stringify({ pages }));
await loading.destroy();
