import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal Dodo Payments client (https://docs.dodopayments.com), using plain fetch so the
 * app needs no extra dependency.
 *
 * Environment:
 *   DODO_PAYMENTS_API_KEY         secret API key from the Dodo dashboard
 *   DODO_PAYMENTS_WEBHOOK_SECRET  signing secret of the webhook endpoint (whsec_…)
 *   DODO_PAYMENTS_PRODUCT_ID      the Switchboard Pro product (pdt_…), one-time $9.99
 *   DODO_PAYMENTS_ENVIRONMENT     "test_mode" (default) or "live_mode"
 */
// Values pasted into a dashboard often carry stray spaces, line breaks or quotes; strip them.
const clean = (value: string | undefined) => value?.trim().replace(/^["']|["']$/g, '').trim() || undefined;

export const dodoConfig = {
  apiKey: clean(process.env.DODO_PAYMENTS_API_KEY),
  webhookSecret: clean(process.env.DODO_PAYMENTS_WEBHOOK_SECRET),
  productId: clean(process.env.DODO_PAYMENTS_PRODUCT_ID),
  environment: /^live/i.test(clean(process.env.DODO_PAYMENTS_ENVIRONMENT) ?? '') ? 'live_mode' : 'test_mode',
};

export const isDodoConfigured = () => Boolean(dodoConfig.apiKey && dodoConfig.productId);

const baseUrl = () => (dodoConfig.environment === 'live_mode' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com');

export class DodoError extends Error {
  constructor(message: string, readonly userMessage = 'Payments are temporarily unavailable. Please try again shortly.') {
    super(message);
  }
}

async function dodoRequest<T>(path: string, body?: unknown): Promise<T> {
  if (!dodoConfig.apiKey) throw new DodoError('DODO_PAYMENTS_API_KEY is not set.', 'Payments are not set up yet.');
  const response = await fetch(`${baseUrl()}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${dodoConfig.apiKey}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => { throw new DodoError(`Dodo unreachable: ${String(error)}`); });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    let providerMessage = '';
    try {
      const parsed = JSON.parse(detail) as { message?: unknown; error?: unknown; code?: unknown };
      const text = [parsed.code, parsed.message ?? parsed.error].filter((part) => typeof part === 'string').join(': ');
      providerMessage = text.slice(0, 200);
    } catch { providerMessage = detail.slice(0, 120); }
    throw new DodoError(`Dodo ${path.split('?')[0]} failed: ${response.status} ${detail}`, response.status === 401
      ? `Payments are misconfigured: Dodo rejected the API key in ${dodoConfig.environment === 'live_mode' ? 'live' : 'test'} mode.`
      : response.status === 404
        ? 'Payments are misconfigured: Dodo could not find the product. Check DODO_PAYMENTS_PRODUCT_ID.'
        : `Checkout could not be started (Dodo ${response.status}${providerMessage ? `: ${providerMessage}` : ''}).`);
  }
  return response.json() as Promise<T>;
}

/** Creates a hosted checkout for the subscription product and returns its URL. */
export async function createCheckout(input: { userId: string; email: string; returnUrl: string; customerId?: string | null }) {
  if (!dodoConfig.productId) throw new DodoError('DODO_PAYMENTS_PRODUCT_ID is not set.', 'Payments are not set up yet.');
  const result = await dodoRequest<{ session_id: string; checkout_url: string | null }>('/checkouts', {
    product_cart: [{ product_id: dodoConfig.productId, quantity: 1 }],
    customer: input.customerId ? { customer_id: input.customerId } : { email: input.email },
    return_url: input.returnUrl,
    // Lets the webhook link the subscription to this account even if the email differs.
    metadata: { user_id: input.userId },
  });
  if (!result.checkout_url) throw new DodoError('Dodo returned no checkout_url.');
  return result.checkout_url;
}

/** Returns a link to Dodo's customer portal, where the user can update payment details or cancel. */
export async function createPortalLink(customerId: string, returnUrl: string) {
  const query = new URLSearchParams({ return_url: returnUrl });
  const result = await dodoRequest<{ link: string }>(`/customers/${encodeURIComponent(customerId)}/customer-portal/session?${query}`, {});
  return result.link;
}

/**
 * Verifies a webhook per the Standard Webhooks spec used by Dodo: HMAC-SHA256 over
 * "{webhook-id}.{webhook-timestamp}.{raw body}" with the base64-decoded secret (after "whsec_"),
 * compared against every "v1,<base64>" entry in the webhook-signature header.
 */
export function verifyWebhook(rawBody: string, headers: Headers, secret: string, now = Date.now()) {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatures = headers.get('webhook-signature');
  if (!id || !timestamp || !signatures) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 5 * 60) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type DodoSubscriptionEvent = {
  type: string;
  data: {
    payload_type?: string;
    payment_id?: string;
    refund_id?: string;
    is_partial?: boolean;
    subscription_id?: string | null;
    status?: string;
    product_id?: string;
    next_billing_date?: string | null;
    cancel_at_next_billing_date?: boolean;
    customer?: { customer_id?: string; email?: string };
    metadata?: Record<string, string>;
  };
};

/** Statuses that grant Pro access. "past_due" keeps access during Dodo's grace period. */
export const ACCESS_STATUSES = new Set(['active', 'past_due']);

/** Maps a subscription webhook to the status we store. */
export function statusFromEvent(event: DodoSubscriptionEvent): string | null {
  switch (event.type) {
    case 'subscription.active':
    case 'subscription.renewed':
    case 'subscription.plan_changed':
      return 'active';
    case 'subscription.updated':
      return event.data.status ?? null;
    case 'subscription.past_due':
      return 'past_due';
    case 'subscription.on_hold':
      return 'on_hold';
    case 'subscription.cancelled':
      return 'cancelled';
    case 'subscription.expired':
      return 'expired';
    case 'subscription.failed':
      return 'failed';
    default:
      return null;
  }
}

/**
 * Whether a stored subscription currently grants Pro. A cancelled subscription keeps access
 * until the end of the period the customer already paid for.
 */
export function subscriptionGrantsAccess(row: { status: string; current_period_end?: string | null }, now = Date.now()) {
  // 'lifetime' = paid the one-time Pro fee.
  if (row.status === 'lifetime' || ACCESS_STATUSES.has(row.status) || row.status === 'trialing') return true;
  if (row.status === 'cancelled' && row.current_period_end) return new Date(row.current_period_end).getTime() > now;
  return false;
}

type DodoPayment = {
  payment_id: string;
  product_cart?: Array<{ product_id?: string }> | null;
  status?: string | null;
  subscription_id?: string | null;
  customer?: { customer_id?: string; email?: string };
  metadata?: Record<string, unknown>;
};

type DodoSubscription = {
  subscription_id: string;
  status: string;
  product_id?: string;
  next_billing_date?: string | null;
  cancel_at_next_billing_date?: boolean;
  customer?: { customer_id?: string; email?: string };
  metadata?: Record<string, string>;
};

export const getPayment = (paymentId: string) => dodoRequest<DodoPayment>(`/payments/${encodeURIComponent(paymentId)}`);
export const getSubscription = (subscriptionId: string) => dodoRequest<DodoSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
