import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { isDemoMode } from '../../../lib/auth/config';
import { extractDocumentText } from '../../../lib/documents/validation';
import { saveDocument } from '../../../lib/server/mock-store';

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  if (!isDemoMode) return NextResponse.json({ error: 'Document storage is not configured.' }, { status: 503 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'A document file is required.' }, { status: 400 });
  try {
    const text = await extractDocumentText(file);
    return NextResponse.json(saveDocument(session!.userId, file.name, text));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Document validation failed.' }, { status: 422 });
  }
}
