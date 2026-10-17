import { z } from 'zod';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const supportedDocumentTypes = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export const documentMetadataSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(supportedDocumentTypes),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
}).strict();

export function validateDocument(file: { name: string; type: string; size: number }) {
  return documentMetadataSchema.parse({
    name: file.name,
    type: file.type || inferType(file.name),
    size: file.size,
  });
}

function inferType(name: string) {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'txt') return 'text/plain';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return '';
}

export async function extractDocumentText(file: File) {
  const metadata = validateDocument(file);
  let text: string;
  if (metadata.type === 'text/plain') {
    text = await file.text();
  } else if (metadata.type === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })).value;
  }
  if (!text.trim()) throw new Error('The uploaded document is empty.');
  return text;
}
