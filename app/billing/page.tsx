'use client';

import { useEffect, useState } from 'react';

export default function Billing() {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/billing').then((response) => response.json()).then((result) => setActive(result.active === true)).finally(() => setLoading(false));
  }, []);
  async function activateDemo() {
    setLoading(true);
    const response = await fetch('/api/billing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'activate-demo' }) });
    if (response.ok) setActive(true);
    setLoading(false);
  }
  return <main className="main"><div className="container"><div className="page-head"><div><div className="eyebrow">Plans</div><h1>Keep tailoring when the free runs out.</h1><p>Start with three complete analyses. Then continue for $9.99/month.</p></div></div><div className="grid-2"><div className="card"><div className="eyebrow">Free</div><h2 style={{marginTop:8}}>$0</h2><p>Three analyses per account</p><div className="notice success">{active ? 'An active subscription is covering new analyses.' : 'You have 3 free analyses in demo mode.'}</div></div><div className="card"><div className="eyebrow">Switchboard Pro</div><h2 style={{marginTop:8}}>$9.99 <small style={{fontSize:14,color:'var(--muted)'}}>/ month</small></h2><p>Unlimited review-first tailoring with private exports.</p><button className="button primary" onClick={activateDemo} disabled={loading || active}>{active ? 'Subscription active' : 'Start checkout (demo) →'}</button><p className="field-note">Demo checkout updates the server-side mock subscription only. Production billing requires a verified webhook.</p></div></div></div></main>;
}
