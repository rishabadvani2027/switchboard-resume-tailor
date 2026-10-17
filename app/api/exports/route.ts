import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { isDemoMode } from '../../../lib/auth/config';
import { assembleResume, canExport } from '../../../lib/export/assemble';
import { getAnalysis, getCompletedOperations, getExport, saveExport } from '../../../lib/server/mock-store';

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  if (!isDemoMode) return NextResponse.json({ error: 'Export persistence is not configured.' }, { status: 503 });
  const body = await request.json().catch(() => null) as { analysisId?: unknown } | null;
  if (typeof body?.analysisId !== 'string') return NextResponse.json({ error: 'analysisId is required' }, { status: 400 });
  const analysis = getAnalysis(body.analysisId, session!.userId);
  if (!analysis) return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 });
  const existing = getExport(session!.userId, analysis.id);
  if (existing) return NextResponse.json({ content: existing.content, status: 'ready', operationCount: getCompletedOperations(session!.userId), persisted: true });
  if (!canExport(analysis.changes)) return NextResponse.json({ error: 'Every change must be approved or rejected before export.' }, { status: 409 });
  try {
    const content = assembleResume(analysis.source, analysis.changes);
    const exported = saveExport(session!.userId, analysis.id, content);
    return NextResponse.json({ content: exported.content, status: 'ready', operationCount: getCompletedOperations(session!.userId), persisted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Export validation failed.' }, { status: 422 });
  }
}
