import { NextResponse } from 'next/server';
import { isDemoMode } from '../../../lib/auth/config';
import { requireSession } from '../../../lib/auth/require-session';
import { hasActiveSubscription, setSubscriptionStatus } from '../../../lib/server/mock-store';

export async function GET(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  if (!isDemoMode) return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 });
  return NextResponse.json({ active: hasActiveSubscription(session!.userId), price: 9.99 });
}

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  if (!isDemoMode) return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (body?.action !== 'activate-demo') return NextResponse.json({ error: 'Unsupported billing action.' }, { status: 400 });
  setSubscriptionStatus(session!.userId, 'active');
  return NextResponse.json({ active: true, price: 9.99 });
}
