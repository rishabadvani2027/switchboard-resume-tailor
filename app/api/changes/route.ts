import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { errorResponse } from '../../../lib/server/http';
import { getStore } from '../../../lib/server/store';
import type { ChangeStatus } from '../../../lib/tailoring/types';
import { buildSkillsChange } from '../../../lib/ats/add-skills';
import { assembleResume } from '../../../lib/export/assemble';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const statuses: ChangeStatus[] = ['pending', 'approved', 'rejected'];

/**
 * Records review decisions. Body: { analysisId, status, changeId } for one change,
 * { analysisId, status, changeIds: [...] } for several, or { analysisId, status, scope: 'pending' }
 * to decide every undecided change at once.
 */
export async function PATCH(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  const body = await request.json().catch(() => null) as { analysisId?: unknown; changeId?: unknown; changeIds?: unknown; scope?: unknown; status?: unknown } | null;
  const status = body?.status as ChangeStatus;
  if (typeof body?.analysisId !== 'string' || !statuses.includes(status)) {
    return NextResponse.json({ error: 'analysisId and a valid status are required.' }, { status: 400 });
  }
  try {
    const store = getStore(session!);
    const analysis = await store.getAnalysis(body.analysisId);
    if (!analysis) return NextResponse.json({ error: 'That analysis was not found.' }, { status: 404 });

    let ids: string[];
    if (body.scope === 'pending') ids = analysis.changes.filter((change) => change.status === 'pending').map((change) => change.id);
    else if (body.scope === 'all') ids = analysis.changes.map((change) => change.id);
    else if (Array.isArray(body.changeIds)) ids = body.changeIds.filter((id): id is string => typeof id === 'string');
    else if (typeof body.changeId === 'string') ids = [body.changeId];
    else return NextResponse.json({ error: 'Specify changeId, changeIds or scope.' }, { status: 400 });

    const known = new Set(analysis.changes.map((change) => change.id));
    if (ids.some((id) => !known.has(id))) return NextResponse.json({ error: 'That change was not found.' }, { status: 404 });

    await store.setChangeStatus(analysis.id, ids, status);
    return NextResponse.json({ updated: ids, status });
  } catch (error) {
    return errorResponse(error, 'That decision could not be saved.');
  }
}

/**
 * Adds skills the user confirmed they have: { analysisId, skills: string[] }.
 * Creates one approved change on the skills line (or a new "Skills:" line).
 */
export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  const body = await request.json().catch(() => null) as { analysisId?: unknown; skills?: unknown } | null;
  const skills = Array.isArray(body?.skills) ? body!.skills.filter((skill): skill is string => typeof skill === 'string') : [];
  if (typeof body?.analysisId !== 'string' || skills.length === 0) {
    return NextResponse.json({ error: 'Choose at least one skill to add.' }, { status: 400 });
  }
  try {
    const store = getStore(session!);
    const analysis = await store.getAnalysis(body.analysisId);
    if (!analysis) return NextResponse.json({ error: 'That analysis was not found.' }, { status: 404 });
    const userAdded = analysis.changes.filter((change) => change.id.startsWith('chg-u')).length;
    const change = buildSkillsChange(analysis.source, analysis.changes, skills, `chg-u${String(userAdded + 1).padStart(2, '0')}`);
    if (!change) return NextResponse.json({ error: 'There is no free spot in your resume to add skills. Reject the skills-line suggestion first, then try again.' }, { status: 409 });
    // Make sure the resume still assembles cleanly with the new change before saving it.
    assembleResume(analysis.source, [...analysis.changes, change], { includePending: true });
    await store.addChange(analysis.id, change);
    return NextResponse.json({ change });
  } catch (error) {
    return errorResponse(error, 'Those skills could not be added.');
  }
}
