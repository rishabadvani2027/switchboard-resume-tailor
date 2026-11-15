import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/auth/require-session';
import { assembleResume, canExport } from '../../../../lib/export/assemble';
import { buildWordFile } from '../../../../lib/format/render';
import { errorResponse } from '../../../../lib/server/http';
import { getStore } from '../../../../lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/exports/file?analysisId=… → the tailored resume as a Word file in the uploaded format. */
export async function GET(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  const analysisId = new URL(request.url).searchParams.get('analysisId');
  if (!analysisId) return NextResponse.json({ error: 'analysisId is required.' }, { status: 400 });
  try {
    const store = getStore(session!);
    const analysis = await store.getAnalysis(analysisId);
    if (!analysis) return NextResponse.json({ error: 'That analysis was not found.' }, { status: 404 });
    if (!canExport(analysis.changes)) return NextResponse.json({ error: 'Approve or reject every change before exporting.' }, { status: 409 });
    const finalText = assembleResume(analysis.source, analysis.changes);
    const { file, preserved, skipped } = await buildWordFile(store, analysis, finalText);
    const slug = analysis.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    return new NextResponse(Buffer.from(file), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="resume${slug ? `-${slug}` : ''}.docx"`,
        'cache-control': 'no-store',
        'x-format-preserved': String(preserved),
        'x-changes-not-placed': String(skipped),
      },
    });
  } catch (error) {
    return errorResponse(error, 'The Word file could not be created.');
  }
}
