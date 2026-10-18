import { z } from 'zod';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const supportedDocumentTypes = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export const documentMetadataSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(supportedDocumentTypes),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
}).strict();

export class DocumentError extends Error {}

export function validateDocument(file: { name: string; type: string; size: number }) {
  // Browsers report generic or empty MIME types for some files (e.g. .md, or .docx on Windows),
  // so prefer the extension when the reported type is not one we support.
  const reported = file.type as typeof supportedDocumentTypes[number];
  const type = supportedDocumentTypes.includes(reported) ? reported : inferType(file.name);
  const result = documentMetadataSchema.safeParse({ name: file.name, type, size: file.size });
  if (!result.success) {
    if (!type) throw new DocumentError('Unsupported file type. Upload a PDF, DOCX or TXT file.');
    if (file.size > MAX_DOCUMENT_BYTES) throw new DocumentError('That document is larger than the 5 MB limit.');
    if (file.size <= 0) throw new DocumentError('That document is empty.');
    throw new DocumentError('That document could not be accepted.');
  }
  return result.data;
}

function inferType(name: string) {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'txt' || extension === 'md' || extension === 'text') return 'text/plain';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return '';
}

/**
 * pdfjs (used by pdf-parse) expects a few browser globals at import time. Text extraction does
 * not render anything, so a minimal DOMMatrix is enough when the optional native canvas package
 * is unavailable (a common cause of "DOMMatrix is not defined" on serverless hosts).
 */
function ensurePdfGlobals() {
  const scope = globalThis as Record<string, unknown>;
  if (typeof scope.DOMMatrix === 'undefined') {
    scope.DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[]) { if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init; }
      multiplySelf() { return this; }
      preMultiplySelf() { return this; }
      translate() { return this; }
      translateSelf() { return this; }
      scale() { return this; }
      scaleSelf() { return this; }
      invertSelf() { return this; }
    };
  }
}

export function cleanExtractedText(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/^\s*-- \d+ of \d+ --\s*$/gm, '') // pdf-parse page markers
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(bytes: ArrayBuffer) {
  ensurePdfGlobals();
  const { PDFParse } = await import('pdf-parse');
  try {
    const path = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    PDFParse.setWorker(pathToFileURL(path.join(process.cwd(), 'node_modules/pdf-parse/dist/worker/pdf.worker.mjs')).href);
  } catch {
    // Fall back to pdfjs' default worker resolution.
  }
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export async function extractDocumentText(file: { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }) {
  const metadata = validateDocument(file);
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    if (metadata.type === 'text/plain') {
      text = new TextDecoder('utf-8').decode(bytes);
    } else if (metadata.type === 'application/pdf') {
      text = await extractPdf(bytes);
    } else {
      const mammoth = await import('mammoth');
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    }
  } catch (error) {
    console.error('[documents] extraction failed', error);
    throw new DocumentError(metadata.type === 'application/pdf'
      ? 'We could not read text from that PDF. If it is a scanned image, paste the text instead.'
      : 'We could not read that document. Try another file or paste the text instead.');
  }
  const cleaned = cleanExtractedText(text);
  if (!cleaned) {
    throw new DocumentError(metadata.type === 'application/pdf'
      ? 'That PDF has no selectable text (it may be a scanned image). Paste the text instead.'
      : 'The uploaded document is empty.');
  }
  return { metadata, text: cleaned, bytes };
}
