import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { isDemoMode } from '../../../lib/auth/config';
import { getAnalysis, updateChange } from '../../../lib/server/mock-store';

export async function PATCH(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  if (!isDemoMode) return NextResponse.json({ error: 'Change persistence is not configured.' }, { status: 503 });
  const body = await request.json().catch(() => null) as { analysisId?: unknown; changeId?: unknown; status?: unknown } | null;
  if (typeof body?.analysisId !== 'string' || typeof body.changeId !== 'string' || (body.status !== 'approved' && body.status !== 'rejected')) {
    return NextResponse.json({ error: 'analysisId, changeId, and a valid status are required' }, { status: 400 });
  }
  const analysis = getAnalysis(body.analysisId, session!.userId);
  if (!analysis) return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 });
  const change = updateChange(body.analysisId, body.changeId, session!.userId, body.status);
  if (!change) return NextResponse.json({ error: 'Change not found.' }, { status: 404 });
  return NextResponse.json({ change });
}
