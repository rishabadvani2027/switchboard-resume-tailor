import { z } from 'zod';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const supportedDocumentTypes = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export const documentMetadataSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(supportedDocumentTypes),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
}).strict();

export function validateDocument(file: { name: string; type: string; size: number }) {
  return documentMetadataSchema.parse({ ...file, type: file.type || inferType(file.name) });
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
  if (metadata.type !== 'text/plain') {
    throw new Error('PDF and DOCX extraction requires the configured server parser.');
  }
  const text = await file.text();
  if (!text.trim()) throw new Error('The uploaded document is empty.');
  return text;
}
