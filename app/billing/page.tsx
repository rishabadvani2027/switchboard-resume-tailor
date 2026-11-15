'use client';
import { useCallback, useEffect, useState } from 'react';

type Billing = {
  active: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canManage: boolean;
  completed: number;
  freeLimit: number;
  remaining: number;
  price: number;
  checkoutAvailable: boolean;
  demo: boolean;
};

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function BillingPage() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [limitHit, setLimitHit] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/billing', { cache: 'no-store' });
    if (!response.ok) throw new Error('Billing status could not be loaded.');
    const result = await response.json() as Billing;
    setBilling(result);
    return result;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setLimitHit(params.get('reason') === 'limit');
    const returnedFromCheckout = params.get('checkout') === 'done';
    // Dodo appends ?status=… to the return URL; a declined or abandoned payment must not be shown as "confirming".
    const returnStatus = (params.get('status') || '').toLowerCase();
    const paymentFailed = returnedFromCheckout && ['failed', 'cancelled', 'canceled', 'requires_payment_method', 'expired'].includes(returnStatus);
    load()
      .then(async (first) => {
        if (paymentFailed && !first.active) {
          setMessage({ kind: 'error', text: 'Your payment didn’t go through, and you haven’t been charged. Please try again with another card or payment method.' });
          return;
        }
        if (!returnedFromCheckout || first.active) {
          if (returnedFromCheckout) setMessage({ kind: 'success', text: 'Payment received — Switchboard Pro is active. Thank you!' });
          return;
        }
        // The payment webhook can arrive a few seconds after the redirect back here.
        setMessage({ kind: 'info', text: 'Confirming your payment…' });
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const next = await load();
          if (next.active) { setMessage({ kind: 'success', text: 'Payment received — Switchboard Pro is active. Thank you!' }); return; }
        }
        setMessage({ kind: 'info', text: 'We haven’t received confirmation from the payment provider yet. If you completed payment, refresh this page in a minute.' });
      })
      .catch((reason: Error) => setMessage({ kind: 'error', text: reason.message }))
      .finally(() => { if (returnedFromCheckout) window.history.replaceState(null, '', '/billing'); });
  }, [load]);

  async function post(action: 'checkout' | 'portal' | 'activate-demo') {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/billing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
      if (result.url) { window.location.href = result.url; return; }
      await load();
    } catch (reason) {
      setMessage({ kind: 'error', text: reason instanceof Error ? reason.message : 'Something went wrong.' });
    }
    setBusy(false);
  }

  const price = billing?.price ?? 9.99;
  const statusNote = billing?.active
    ? billing.status === 'past_due'
      ? 'Your last payment failed — update your payment method to keep Pro.'
      : billing.status === 'cancelled' || billing.cancelAtPeriodEnd
        ? `Cancelled — Pro stays active until ${formatDate(billing.currentPeriodEnd)}.`
        : billing.currentPeriodEnd ? `Renews on ${formatDate(billing.currentPeriodEnd)}.` : 'Active.'
    : billing?.status === 'on_hold'
      ? 'Your subscription is on hold because a payment failed. Update your payment method to restore Pro.'
      : null;

  return (
    <main className="main"><div className="container">
      <div className="page-head"><div><div className="eyebrow">Plans</div><h1>Keep tailoring when the free runs out.</h1><p>Start with three complete analyses. Then continue for ${price}/month.</p></div></div>
      {limitHit && !billing?.active && <div className="notice error" role="alert" style={{ marginBottom: 12 }}>You have used all your free analyses. Upgrade, or add your own AI key to keep going for free.</div>}
      {message && <div className={`notice ${message.kind}`} role="status" style={{ marginBottom: 12 }}>{message.text}</div>}
      {!billing?.active && <div className="notice info">Prefer not to subscribe? <a className="inline-link" href="/settings">Bring your own AI key</a> for unlimited free analyses — you pay your AI provider directly.</div>}
      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="eyebrow">Free</div>
          <h2 style={{ marginTop: 8 }}>$0</h2>
          <p>Three analyses per account</p>
          {billing && <div className={`notice ${billing.remaining > 0 || billing.active ? 'success' : 'error'}`}>{billing.active ? 'Your subscription covers new analyses.' : `${billing.completed} used · ${billing.remaining} remaining`}</div>}
        </div>
        <div className="card stack">
          <div>
            <div className="eyebrow">Switchboard Pro</div>
            <h2 style={{ marginTop: 8 }}>${price} <small style={{ fontSize: 14, color: 'var(--muted)' }}>/ month</small></h2>
            <p>Unlimited review-first tailoring with private exports.</p>
          </div>
          {statusNote && <div className={`notice ${billing?.active && billing.status !== 'past_due' ? 'success' : 'error'}`}>{statusNote}</div>}
          {billing?.active || billing?.status === 'on_hold'
            ? billing?.canManage && <button className="button secondary" onClick={() => post('portal')} disabled={busy}>{busy ? 'Opening…' : 'Manage subscription →'}</button>
            : <button className="button primary" onClick={() => post(billing?.demo ? 'activate-demo' : 'checkout')} disabled={busy || !billing?.checkoutAvailable}>
              {busy ? 'Opening checkout…' : billing?.demo ? 'Activate (demo) →' : 'Upgrade to Pro →'}
            </button>}
          <p className="field-note">
            {billing?.demo
              ? 'Demo mode: activates a local test subscription.'
              : billing?.checkoutAvailable
                ? 'Secure checkout by Dodo Payments. Cancel anytime from “Manage subscription”.'
                : 'Online payments are coming soon.'}
          </p>
        </div>
      </div>
    </div></main>
  );
}
