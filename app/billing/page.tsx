'use client';
import { useEffect, useState } from 'react';

type Billing = { active: boolean; completed: number; freeLimit: number; remaining: number; price: number; checkoutAvailable: boolean };

export default function BillingPage() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [limitHit, setLimitHit] = useState(false);

  useEffect(() => {
    setLimitHit(new URLSearchParams(window.location.search).get('reason') === 'limit');
    fetch('/api/billing')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Billing status could not be loaded.'))))
      .then(setBilling)
      .catch((reason: Error) => setMessage(reason.message))
      .finally(() => setLoading(false));
  }, []);

  async function upgrade() {
    setLoading(true);
    setMessage('');
    const response = await fetch('/api/billing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'activate-demo' }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) setBilling((current) => (current ? { ...current, active: true } : current));
    else setMessage(result.error || 'Upgrade is not available yet.');
    setLoading(false);
  }

  const price = billing?.price ?? 9.99;
  return (
    <main className="main"><div className="container">
      <div className="page-head"><div><div className="eyebrow">Plans</div><h1>Keep tailoring when the free runs out.</h1><p>Start with three complete analyses. Then continue for ${price}/month.</p></div></div>
      {limitHit && !billing?.active && <div className="notice error" role="alert" style={{ marginBottom: 12 }}>You have used all your free analyses. Upgrade, or add your own AI key to keep going for free.</div>}
      {!billing?.active && <div className="notice info">Prefer not to subscribe? <a className="inline-link" href="/settings">Bring your own AI key</a> for unlimited free analyses — you pay your AI provider directly.</div>}
      {message && <div className="notice info" role="status">{message}</div>}
      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="eyebrow">Free</div>
          <h2 style={{ marginTop: 8 }}>$0</h2>
          <p>Three analyses per account</p>
          {billing && <div className={`notice ${billing.remaining > 0 || billing.active ? 'success' : 'error'}`}>{billing.active ? 'Your subscription covers new analyses.' : `${billing.completed} used · ${billing.remaining} remaining`}</div>}
        </div>
        <div className="card">
          <div className="eyebrow">Switchboard Pro</div>
          <h2 style={{ marginTop: 8 }}>${price} <small style={{ fontSize: 14, color: 'var(--muted)' }}>/ month</small></h2>
          <p>Unlimited review-first tailoring with private exports.</p>
          <button className="button primary" onClick={upgrade} disabled={loading || billing?.active}>{billing?.active ? 'Subscription active' : billing?.checkoutAvailable ? 'Activate (demo) →' : 'Upgrade →'}</button>
          <p className="field-note">{billing?.checkoutAvailable ? 'Demo mode: activates a local test subscription.' : 'Online card payments are coming soon.'}</p>
        </div>
      </div>
    </div></main>
  );
}
