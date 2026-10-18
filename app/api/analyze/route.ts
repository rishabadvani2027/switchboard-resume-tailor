import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { canStartOperation } from '../../../lib/billing/entitlements';
import { errorResponse } from '../../../lib/server/http';
import { getStore, type AnalysisRecord } from '../../../lib/server/store';
import { createByokProvider, getTailoringProvider, parseByok } from '../../../lib/tailoring/provider';
import { validateTailoringResult } from '../../../lib/tailoring/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// AI analysis can take a while for long resumes.
export const maxDuration = 120;

const MAX_TEXT = 60_000;

const present = (analysis: AnalysisRecord) => ({
  analysisId: analysis.id,
  title: analysis.title,
  status: analysis.status,
  source: analysis.source,
  jobDescription: analysis.jobDescription,
  changes: analysis.changes,
  insights: analysis.insights,
  provider: analysis.provider,
  createdAt: analysis.createdAt,
});

function deriveTitle(jobDescription: string) {
  const firstLine = jobDescription.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? 'Untitled role';
  return firstLine.replace(/\s+/g, ' ').slice(0, 90);
}

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  const body = await request.json().catch(() => null) as { resume?: unknown; jobDescription?: unknown; idempotencyKey?: unknown; title?: unknown; byok?: unknown } | null;
  const resume = typeof body?.resume === 'string' ? body.resume.replace(/\r\n/g, '\n') : '';
  const jobDescription = typeof body?.jobDescription === 'string' ? body.jobDescription.replace(/\r\n/g, '\n') : '';
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!resume.trim() || !jobDescription.trim()) {
    return NextResponse.json({ error: 'Add both your resume and the job description.' }, { status: 400 });
  }
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json({ error: 'A request key is required. Refresh the page and try again.' }, { status: 400 });
  }
  if (resume.length > MAX_TEXT || jobDescription.length > MAX_TEXT) {
    return NextResponse.json({ error: 'The resume or job description is too long (60,000 characters max).' }, { status: 413 });
  }

  try {
    const store = getStore(session!);
    const existing = await store.findByIdempotencyKey(idempotencyKey);
    if (existing) return NextResponse.json(present(existing));

    // With their own key, users pay their AI provider directly, so the free allowance does not apply.
    // The key is used for this request only and is never stored or logged.
    const byok = parseByok(body?.byok);
    if (!byok) {
      const [completed, subscribed] = await Promise.all([store.countCompletedAnalyses(), store.hasActiveSubscription()]);
      if (!canStartOperation(completed, subscribed)) {
        return NextResponse.json({ error: 'You have used your 3 free analyses. Add your own AI key in AI settings (free, unlimited) or upgrade.', code: 'subscription-required' }, { status: 402 });
      }
    }

    const provider = byok ? createByokProvider(byok) : getTailoringProvider();
    const result = validateTailoringResult(await provider.analyze({ resume, jobDescription }), resume);
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 90) : deriveTitle(jobDescription);
    const saved = await store.createAnalysis({
      id: result.analysisId,
      idempotencyKey,
      title,
      source: resume,
      jobDescription,
      changes: result.changes,
      insights: result.insights ?? { summary: '', matchedKeywords: [], missingKeywords: [] },
      provider: result.provider,
    });
    return NextResponse.json(present(saved));
  } catch (error) {
    return errorResponse(error, 'The analysis could not be completed. Please try again.');
  }
}

export async function GET(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  try {
    const store = getStore(session!);
    const id = new URL(request.url).searchParams.get('analysisId');
    if (!id) {
      const [analyses, completed, subscribed] = await Promise.all([store.listAnalyses(20), store.countCompletedAnalyses(), store.hasActiveSubscription()]);
      return NextResponse.json({ analyses, completed, subscribed });
    }
    const analysis = await store.getAnalysis(id);
    if (!analysis) return NextResponse.json({ error: 'That analysis was not found.' }, { status: 404 });
    return NextResponse.json(present(analysis));
  } catch (error) {
    return errorResponse(error, 'The analysis could not be loaded.');
  }
}
