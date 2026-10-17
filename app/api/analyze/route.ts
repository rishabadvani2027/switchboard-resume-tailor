import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { isDemoMode } from '../../../lib/auth/config';
import { getAnalysis, getOperationResult, releaseOperation, recordCompletedOperation, reserveOperation, saveAnalysis } from '../../../lib/server/mock-store';
import { getTailoringProvider } from '../../../lib/tailoring/provider';
import { validateTailoringResult } from '../../../lib/tailoring/types';

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  if (!isDemoMode) return NextResponse.json({ error: 'Analysis persistence is not configured.' }, { status: 503 });
  const body = await request.json().catch(() => null) as { resume?: unknown; jobDescription?: unknown; idempotencyKey?: unknown } | null;
  if (typeof body?.resume !== 'string' || typeof body.jobDescription !== 'string' || !body.resume.trim() || !body.jobDescription.trim() || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 200) {
    return NextResponse.json({ error: 'resume, jobDescription, and a caller-supplied idempotencyKey are required' }, { status: 400 });
  }

  const operationKey = body.idempotencyKey;
  const reservation = reserveOperation(session!.userId, operationKey);
  if (!reservation.allowed) {
    return NextResponse.json({ error: 'Subscription required to start another analysis.' }, { status: 402 });
  }
  if (reservation.alreadyReserved) {
    const existing = getOperationResult(session!.userId, operationKey);
    if (existing) return NextResponse.json({ analysisId: existing.id, status: existing.status, changes: existing.changes, provider: 'server-stored-analysis' });
  }
  try {
    const result = await getTailoringProvider().analyze({ resume: body.resume, jobDescription: body.jobDescription });
    try {
      validateTailoringResult(result, body.resume);
    } catch {
      releaseOperation(session!.userId, operationKey);
      return NextResponse.json({ error: 'Analysis provider returned invalid changes.' }, { status: 502 });
    }
    if (result.status !== 'ready') {
      releaseOperation(session!.userId, operationKey);
      return NextResponse.json({ error: 'Analysis provider failed closed.' }, { status: 502 });
    }
    saveAnalysis({ id: result.analysisId, userId: session!.userId, source: body.resume, jobDescription: body.jobDescription, changes: result.changes, status: 'ready' });
    recordCompletedOperation(session!.userId, operationKey, result.analysisId);
    return NextResponse.json(result);
  } catch {
    releaseOperation(session!.userId, operationKey);
    return NextResponse.json({ error: 'Analysis provider failed closed.' }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  if (!isDemoMode) return NextResponse.json({ error: 'Analysis persistence is not configured.' }, { status: 503 });
  const id = new URL(request.url).searchParams.get('analysisId');
  if (!id) return NextResponse.json({ error: 'analysisId is required' }, { status: 400 });
  const analysis = getAnalysis(id, session!.userId);
  if (!analysis) return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 });
  return NextResponse.json({ analysisId: analysis.id, status: analysis.status, changes: analysis.changes, provider: 'server-stored-analysis', error: analysis.error });
}
