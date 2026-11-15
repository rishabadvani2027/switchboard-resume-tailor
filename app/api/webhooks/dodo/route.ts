import { NextResponse } from 'next/server';
import { dodoConfig, statusFromEvent, verifyWebhook, type DodoSubscriptionEvent } from '../../../../lib/billing/dodo';
import { adminRest, hasServiceRole } from '../../../../lib/server/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Receives Dodo Payments webhooks and keeps public.subscriptions in sync.
 * Configure in Dodo → Developer → Webhooks: https://<your-domain>/api/webhooks/dodo
 */
export async function POST(request: Request) {
  const secret = dodoConfig.webhookSecret;
  if (!secret || !hasServiceRole()) {
    console.error('[dodo] webhook received but DODO_PAYMENTS_WEBHOOK_SECRET or SUPABASE_SERVICE_ROLE_KEY is missing');
    // 500 makes Dodo retry later, once the configuration is fixed.
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  if (!verifyWebhook(rawBody, request.headers, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: DodoSubscriptionEvent;
  try { event = JSON.parse(rawBody) as DodoSubscriptionEvent; } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const eventId = request.headers.get('webhook-id')!;
  try {
    // Idempotency: a redelivered webhook is acknowledged without being applied twice.
    const seen = await adminRest<Array<{ id: string }>>(`billing_events?select=id&id=eq.${encodeURIComponent(eventId)}`);
    if (seen.length > 0) return NextResponse.json({ received: true, duplicate: true });

    const status = event.type.startsWith('subscription.') ? statusFromEvent(event) : null;
    if (status) await applySubscription(event, status);

    await adminRest('billing_events', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: JSON.stringify({ id: eventId, type: event.type, payload: event }),
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[dodo] webhook processing failed', event.type, error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

async function applySubscription(event: DodoSubscriptionEvent, status: string) {
  const data = event.data;
  const subscriptionId = data.subscription_id;
  const customerId = data.customer?.customer_id ?? null;

  // Find the account: checkout metadata first, then a row we already linked to this subscription/customer.
  let userId = data.metadata?.user_id && UUID.test(data.metadata.user_id) ? data.metadata.user_id : null;
  if (!userId && subscriptionId) {
    const rows = await adminRest<Array<{ user_id: string }>>(`subscriptions?select=user_id&provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}`);
    userId = rows[0]?.user_id ?? null;
  }
  if (!userId && customerId) {
    const rows = await adminRest<Array<{ user_id: string }>>(`subscriptions?select=user_id&provider_customer_id=eq.${encodeURIComponent(customerId)}`);
    userId = rows[0]?.user_id ?? null;
  }
  if (!userId) {
    console.warn('[dodo] could not match subscription to a user', event.type, subscriptionId);
    return;
  }

  await adminRest('subscriptions?on_conflict=user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify({
      user_id: userId,
      status,
      provider_customer_id: customerId,
      provider_subscription_id: subscriptionId ?? null,
      product_id: data.product_id ?? null,
      current_period_end: data.next_billing_date ?? null,
      cancel_at_period_end: Boolean(data.cancel_at_next_billing_date),
      updated_at: new Date().toISOString(),
    }),
  });
}
