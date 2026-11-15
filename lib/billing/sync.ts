import { adminRest } from '../server/admin';
import { getPayment, getSubscription, type DodoSubscriptionEvent } from './dodo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Upserts the user's row in public.subscriptions (service role). */
export async function saveSubscription(row: {
  userId: string;
  status: string;
  customerId: string | null;
  subscriptionId: string | null;
  productId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}) {
  await adminRest('subscriptions?on_conflict=user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify({
      user_id: row.userId,
      status: row.status,
      provider_customer_id: row.customerId,
      provider_subscription_id: row.subscriptionId,
      product_id: row.productId,
      current_period_end: row.currentPeriodEnd,
      cancel_at_period_end: row.cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    }),
  });
}

/** Applies a verified subscription webhook to the matching account. */
export async function applySubscriptionEvent(event: DodoSubscriptionEvent, status: string) {
  const data = event.data;
  const subscriptionId = data.subscription_id ?? null;
  const customerId = data.customer?.customer_id ?? null;

  // Find the account: checkout metadata first, then a row already linked to this subscription/customer.
  let userId = typeof data.metadata?.user_id === 'string' && UUID.test(data.metadata.user_id) ? data.metadata.user_id : null;
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
    return false;
  }
  await saveSubscription({
    userId,
    status,
    customerId,
    subscriptionId,
    productId: data.product_id ?? null,
    currentPeriodEnd: data.next_billing_date ?? null,
    cancelAtPeriodEnd: Boolean(data.cancel_at_next_billing_date),
  });
  return true;
}

/**
 * Fallback for when the webhook is slow or misconfigured: after checkout redirects back with a
 * payment id, ask Dodo directly and record the subscription. The payment must belong to the
 * signed-in user (checkout metadata user_id, or the same email).
 */
export async function syncFromPayment(paymentId: string, user: { userId: string; email: string }) {
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(paymentId)) return { synced: false, reason: 'invalid-payment-id' };
  const payment = await getPayment(paymentId);
  const ownerId = typeof payment.metadata?.user_id === 'string' ? payment.metadata.user_id : null;
  const sameEmail = payment.customer?.email?.toLowerCase() === user.email.toLowerCase();
  if (ownerId ? ownerId !== user.userId : !sameEmail) return { synced: false, reason: 'not-owner' };
  if (payment.status !== 'succeeded' || !payment.subscription_id) return { synced: false, reason: `payment-${payment.status ?? 'unknown'}` };

  const subscription = await getSubscription(payment.subscription_id);
  await saveSubscription({
    userId: user.userId,
    status: subscription.status,
    customerId: subscription.customer?.customer_id ?? payment.customer?.customer_id ?? null,
    subscriptionId: subscription.subscription_id,
    productId: subscription.product_id ?? null,
    currentPeriodEnd: subscription.next_billing_date ?? null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_next_billing_date),
  });
  return { synced: true, status: subscription.status };
}
