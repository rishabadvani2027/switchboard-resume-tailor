import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { DocumentError, extractDocumentText } from '../../../lib/documents/validation';
import { getStore } from '../../../lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const kind = form?.get('kind') === 'job_description' ? 'job_description' : 'resume';
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'A document file is required.' }, { status: 400 });

  let extracted: Awaited<ReturnType<typeof extractDocumentText>>;
  try {
    extracted = await extractDocumentText(file);
  } catch (error) {
    const message = error instanceof DocumentError ? error.message : 'That document could not be processed.';
    return NextResponse.json({ error: message }, { status: 422 });
  }

  // Keeping a private copy is best-effort: the user should never be blocked from tailoring
  // because storage had a hiccup.
  let id: string | null = null;
  try {
    id = (await getStore(session!).saveDocument({
      name: extracted.metadata.name,
      type: extracted.metadata.type,
      bytes: extracted.bytes,
      text: extracted.text,
      kind,
    })).id;
  } catch (error) {
    console.error('[documents] could not store a private copy', error);
  }
  return NextResponse.json({ id, name: extracted.metadata.name, text: extracted.text });
}
