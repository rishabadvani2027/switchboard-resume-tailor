import { NextResponse } from 'next/server';
import { dodoConfig, statusFromEvent, verifyWebhook, type DodoSubscriptionEvent } from '../../../../lib/billing/dodo';
import { adminRest, hasServiceRole } from '../../../../lib/server/admin';
import { applyOneTimePayment, applyRefund, applySubscriptionEvent } from '../../../../lib/billing/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    await recordRejected(request, rawBody);
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
    if (status) await applySubscriptionEvent(event, status);
    else if (event.type === 'payment.succeeded') await applyOneTimePayment(event);
    else if (event.type === 'refund.succeeded') await applyRefund(event);

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

/**
 * Keeps a trace of rejected deliveries (no secrets, no payload) so a signing-secret mismatch
 * can be diagnosed from the database. Only deliveries that look like Dodo's are recorded.
 */
async function recordRejected(request: Request, rawBody: string) {
  const id = request.headers.get('webhook-id');
  if (!id || !request.headers.get('webhook-signature')) return;
  let type = 'unknown';
  try { type = String((JSON.parse(rawBody) as { type?: unknown }).type ?? 'unknown').slice(0, 60); } catch { /* ignore */ }
  const timestamp = Number(request.headers.get('webhook-timestamp'));
  const skew = Number.isFinite(timestamp) ? Math.round(Date.now() / 1000 - timestamp) : null;
  await adminRest('billing_events', {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=minimal',
    body: JSON.stringify({ id: `rejected:${id}`.slice(0, 200), type: `rejected:${type}`, payload: { reason: 'signature-mismatch', clock_skew_seconds: skew } }),
  }).catch(() => undefined);
}
