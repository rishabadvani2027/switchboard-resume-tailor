import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { assembleResume, canExport } from '../../../lib/export/assemble';
import { errorResponse } from '../../../lib/server/http';
import { getStore } from '../../../lib/server/store';
import { jobKeywords, scoreResume } from '../../../lib/ats/score';
import { buildFormattedExport } from '../../../lib/format/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  const body = await request.json().catch(() => null) as { analysisId?: unknown } | null;
  if (typeof body?.analysisId !== 'string') return NextResponse.json({ error: 'analysisId is required.' }, { status: 400 });
  try {
    const store = getStore(session!);
    // Always assemble from the stored source and decisions; client-supplied content is never trusted.
    const analysis = await store.getAnalysis(body.analysisId);
    if (!analysis) return NextResponse.json({ error: 'That analysis was not found.' }, { status: 404 });
    if (!canExport(analysis.changes)) {
      return NextResponse.json({ error: 'Approve or reject every change before exporting.', code: 'decisions-pending' }, { status: 409 });
    }
    const content = assembleResume(analysis.source, analysis.changes);
    await store.saveExport(analysis.id, content);
    const approved = analysis.changes.filter((change) => change.status === 'approved').length;
    const keywords = jobKeywords(analysis.jobDescription, analysis.insights);
    const atsBefore = scoreResume(analysis.source, analysis.jobDescription, keywords).score;
    const atsAfter = scoreResume(content, analysis.jobDescription, keywords).score;
    const formatted = await buildFormattedExport(store, analysis, content);
    return NextResponse.json({
      content,
      title: analysis.title,
      status: 'ready',
      approved,
      rejected: analysis.changes.length - approved,
      total: analysis.changes.length,
      atsBefore,
      atsAfter,
      ...formatted,
    });
  } catch (error) {
    return errorResponse(error, 'The export could not be created.');
  }
}
