declare module 'pdfmake/js/Printer' {
  import type { Readable } from 'node:stream';
  export default class PdfPrinter {
    constructor(fonts: Record<string, { normal: Buffer }>, virtualfs: undefined,
      resolver: { resolve: (resource: unknown) => void; resolved: () => Promise<void> }, localAccess: () => boolean);
    createPdfKitDocument(definition: object): Promise<Readable & { end(): void }>;
  }
}
