// Ambient declarations for dependencies that ship no types (or none for the
// specific subpath we import).

declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}

// pdfjs-dist ships types at its root but not for this legacy build subpath; we
// cast the dynamic import to a local interface in extractors.ts.
declare module "pdfjs-dist/legacy/build/pdf.mjs";
