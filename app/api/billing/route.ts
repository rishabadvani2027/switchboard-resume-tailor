import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth/require-session';
import { createCheckout, createPortalLink, DodoError, isDodoConfigured } from '../../../lib/billing/dodo';
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
    const [subscription, completed] = await Promise.all([store.getSubscription(), store.countCompletedAnalyses()]);
    return NextResponse.json({
      active: Boolean(subscription?.active),
      status: subscription?.status ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      canManage: Boolean(subscription?.customerId) && isDodoConfigured(),
      completed,
      freeLimit: FREE_OPERATIONS,
      remaining: Math.max(0, FREE_OPERATIONS - completed),
      price: PRO_PRICE_USD,
      checkoutAvailable: store.kind === 'memory' || isDodoConfigured(),
      demo: store.kind === 'memory',
    });
  } catch (error) {
    return errorResponse(error, 'Billing status could not be loaded.');
  }
}

export async function POST(request: Request) {
  const { session, response } = await requireSession(request);
  if (response) return response;
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const origin = new URL(request.url).origin;
  try {
    const store = getStore(session!);

    if (body?.action === 'activate-demo' && store.activateDemoSubscription) {
      await store.activateDemoSubscription();
      return NextResponse.json({ active: true, price: PRO_PRICE_USD });
    }

    if (body?.action === 'checkout') {
      if (!isDodoConfigured()) return NextResponse.json({ error: 'Online checkout is not set up yet.' }, { status: 501 });
      const subscription = await store.getSubscription();
      if (subscription?.active) return NextResponse.json({ error: 'You already have an active subscription.' }, { status: 409 });
      const url = await createCheckout({
        userId: session!.userId,
        email: session!.email,
        customerId: subscription?.customerId,
        returnUrl: `${origin}/billing?checkout=done`,
      });
      return NextResponse.json({ url });
    }

    if (body?.action === 'portal') {
      const subscription = await store.getSubscription();
      if (!subscription?.customerId || !isDodoConfigured()) return NextResponse.json({ error: 'No subscription to manage yet.' }, { status: 404 });
      const url = await createPortalLink(subscription.customerId, `${origin}/billing`);
      return NextResponse.json({ url });
    }

    return NextResponse.json({ error: 'Unsupported billing action.' }, { status: 400 });
  } catch (error) {
    if (error instanceof DodoError) {
      console.error('[billing]', error.message);
      return NextResponse.json({ error: error.userMessage }, { status: 502 });
    }
    return errorResponse(error, 'Billing could not be updated.');
  }
}
