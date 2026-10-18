import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { FREE_OPERATIONS, PRO_PRICE_USD } from '../../../lib/billing/entitlements';
import { errorResponse } from '../../../lib/server/http';
import { getStore } from '../../../lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  try {
    const store = getStore(session!);
    const [active, completed] = await Promise.all([store.hasActiveSubscription(), store.countCompletedAnalyses()]);
    return NextResponse.json({
      active,
      completed,
      freeLimit: FREE_OPERATIONS,
      remaining: Math.max(0, FREE_OPERATIONS - completed),
      price: PRO_PRICE_USD,
      checkoutAvailable: store.kind === 'memory',
    });
  } catch (error) {
    return errorResponse(error, 'Billing status could not be loaded.');
  }
}

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  try {
    const store = getStore(session!);
    if (body?.action === 'activate-demo' && store.activateDemoSubscription) {
      await store.activateDemoSubscription();
      return NextResponse.json({ active: true, price: PRO_PRICE_USD });
    }
    return NextResponse.json({ error: 'Online checkout is not available yet. Contact support to upgrade.' }, { status: 501 });
  } catch (error) {
    return errorResponse(error, 'Billing could not be updated.');
  }
}
