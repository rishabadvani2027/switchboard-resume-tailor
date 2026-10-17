'use client';
import { useEffect, useMemo, useState } from 'react';
import { Steps } from '../../components/Steps';
import type { ResumeChange } from '../../lib/tailoring/types';
import { canExport } from '../../lib/export/assemble';

export default function Review() {
  const [changes, setChanges] = useState<ResumeChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const analysisId = typeof window === 'undefined' ? '' : sessionStorage.getItem('analysisId') || '';

  useEffect(() => {
    if (!analysisId) { setError('No analysis was found. Return to intake and try again.'); setLoading(false); return; }
    fetch(`/api/analyze?analysisId=${encodeURIComponent(analysisId)}`).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error || 'Analysis could not be loaded.');
      return response.json();
    }).then((result) => setChanges(result.changes)).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [analysisId]);

  const pending = useMemo(() => changes.filter((c) => c.status === 'pending').length, [changes]);
  const approved = useMemo(() => changes.filter((c) => c.status === 'approved').length, [changes]);
  const rejected = useMemo(() => changes.filter((c) => c.status === 'rejected').length, [changes]);

  async function decide(id: string, status: 'approved' | 'rejected') {
    const response = await fetch('/api/changes', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ analysisId, changeId: id, status }) });
    if (!response.ok) { setError('That decision could not be saved.'); return; }
    setChanges((current) => current.map((change) => change.id === id ? { ...change, status } : change));
  }

  if (loading) return <main className="main"><div className="container"><Steps active={2}/><div className="card"><h2>Reading your documents…</h2><p>Our isolated tailoring adapter is preparing a small, reviewable set of suggestions.</p></div></div></main>;
  if (error) return <main className="main"><div className="container"><Steps active={2}/><div className="notice error" role="alert">{error}</div></div></main>;
  return <main className="main"><div className="container"><Steps active={2}/><div className="page-head"><div><div className="eyebrow">Review changes</div><h1>Keep what feels true.</h1><p>Approve or reject each suggestion. Nothing is exported automatically.</p></div><span className="status-pill pending">{pending} undecided</span></div><div className="review-layout"><div>{changes.map((change) => <article className="change" key={change.id}><div className="change-head"><div><strong>{change.section}</strong><div className="change-meta">{change.id} · {change.rationale}</div></div><span className={`status-pill ${change.status === 'pending' ? 'pending' : 'ready'}`}>{change.status}</span></div><div className="change-body"><div className="change-pane remove"><div className="pane-label">− Existing</div>{change.original}</div><div className="change-pane add"><div className="pane-label">+ Suggested</div>{change.proposed}</div></div><div className="decision-row"><button className={`decision reject ${change.status === 'rejected' ? 'selected' : ''}`} onClick={() => decide(change.id, 'rejected')}>Reject</button><button className={`decision approve ${change.status === 'approved' ? 'selected' : ''}`} onClick={() => decide(change.id, 'approved')}>Approve</button></div></article>)}</div><aside className="card summary"><h3>Review summary</h3><div className="summary-row"><span>Suggestions</span><strong>{changes.length}</strong></div><div className="summary-row"><span>Approved</span><strong>{approved}</strong></div><div className="summary-row"><span>Rejected</span><strong>{rejected}</strong></div><div className="summary-row"><span>Export</span><strong>{canExport(changes) ? 'Ready' : 'Locked'}</strong></div><button className="button primary" style={{ width: '100%', marginTop: 18 }} disabled={!canExport(changes)} onClick={() => { window.location.href = '/export'; }}>Continue to export <span>→</span></button><p className="field-note">Export unlocks after every change has a decision.</p></aside></div></div></main>;
}
