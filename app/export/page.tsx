'use client';
import { useEffect, useState } from 'react';
import { Steps } from '../../components/Steps';

export default function ExportPage() {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const analysisId = sessionStorage.getItem('analysisId') || '';
    fetch('/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ analysisId }) })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Export failed.'); return result; })
      .then((result) => setContent(result.content))
      .catch((reason: Error) => setError(reason.message));
  }, []);
  function download() {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'switchboard-resume.txt'; anchor.click(); URL.revokeObjectURL(url);
  }
  return <main className="main"><div className="container"><Steps active={3}/>{error ? <div className="notice error" role="alert">{error}</div> : <><div className="page-head"><div><div className="eyebrow">Approved export</div><h1>Your resume, your call.</h1><p>This text includes only changes you approved. Rejected suggestions are not present.</p></div><span className="status-pill ready">Ready to download</span></div><div className="grid-2"><div className="card"><h3>Final document</h3><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.7, color: 'var(--ink)', marginBottom: 0 }}>{content}</pre></div><div className="card stack"><div><h3>Audit summary</h3><div className="summary-row"><span>Source</span><strong>Original resume</strong></div><div className="summary-row"><span>Provider</span><strong>Isolated adapter</strong></div><div className="summary-row"><span>Decisions</span><strong>All recorded</strong></div></div><button className="button primary" onClick={download} disabled={!content}>Download .txt <span>↓</span></button><div className="notice info">Demo exports are plain text. A production adapter can render PDF/DOCX after storage is configured.</div></div></div></>}</div></main>;
}
