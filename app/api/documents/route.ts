import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { authConfig, isDemoMode } from '../../../lib/auth/config';
import { extractDocumentText, validateDocument } from '../../../lib/documents/validation';
import { saveDocument } from '../../../lib/server/mock-store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'A document file is required.' }, { status: 400 });
  try {
    const metadata = validateDocument(file);
    const text = await extractDocumentText(file);
    if (isDemoMode) return NextResponse.json(saveDocument(session!.userId, file.name, text));

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      ?? request.headers.get('cookie')?.match(/(?:^|;\s*)sb-access-token=([^;]+)/)?.[1];
    if (!token || !authConfig.supabaseUrl || !authConfig.supabaseAnonKey) {
      return NextResponse.json({ error: 'Document storage is not configured.' }, { status: 503 });
    }
    const safeName = metadata.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${session!.userId}/${crypto.randomUUID()}-${safeName}`;
    const upload = await fetch(`${authConfig.supabaseUrl}/storage/v1/object/private-documents/${storagePath}`, {
      method: 'POST',
      headers: {
        apikey: authConfig.supabaseAnonKey,
        authorization: `Bearer ${token}`,
        'content-type': metadata.type,
        'x-upsert': 'false',
      },
      body: await file.arrayBuffer(),
      cache: 'no-store',
    });
    if (!upload.ok) return NextResponse.json({ error: 'The document could not be stored.' }, { status: 502 });

    const record = await fetch(`${authConfig.supabaseUrl}/rest/v1/documents`, {
      method: 'POST',
      headers: {
        apikey: authConfig.supabaseAnonKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: session!.userId,
        kind: 'resume',
        storage_path: storagePath,
        extracted_text: text,
      }),
      cache: 'no-store',
    });
    if (!record.ok) return NextResponse.json({ error: 'The document record could not be saved.' }, { status: 502 });
    const rows = await record.json() as Array<{ id: string }>;
    return NextResponse.json({ id: rows[0]?.id, userId: session!.userId, name: metadata.name, text });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Document validation failed.' }, { status: 422 });
  }
}
