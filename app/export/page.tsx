'use client';
import { useEffect, useState } from 'react';
import { Steps } from '../../components/Steps';

type ExportResult = { content: string; title: string; approved: number; rejected: number; total: number };

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

function fileBase(title: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  return `resume${slug ? `-${slug}` : ''}`;
}

function download(name: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function asHtmlDocument(text: string, title: string) {
  const lines = text.split('\n').map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p>&nbsp;</p>')).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.35;margin:0.8in;color:#111}p{margin:0 0 2pt}</style></head><body>${lines}</body></html>`;
}

export default function ExportPage() {
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState('');
  const [analysisId, setAnalysisId] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let id = new URLSearchParams(window.location.search).get('id') || '';
    if (!id) { try { id = sessionStorage.getItem('analysisId') || ''; } catch { /* ignore */ } }
    setAnalysisId(id);
    if (!id) { setError('No analysis was selected. Start from the workspace.'); return; }
    fetch('/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ analysisId: id }) })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Export failed.');
        return body as ExportResult;
      })
      .then(setResult)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function copy() {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.content); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('Copy failed — select the text and copy it manually.'); }
  }

  function printPdf() {
    if (!result) return;
    const win = window.open('', '_blank');
    if (!win) { setError('Allow pop-ups to save as PDF.'); return; }
    win.document.write(asHtmlDocument(result.content, result.title));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  return (
    <main className="main"><div className="container">
      <Steps active={3} />
      {error ? (
        <>
          <div className="notice error" role="alert">{error}</div>
          <p style={{ marginTop: 16 }}><a className="button secondary" href={analysisId ? `/review?id=${encodeURIComponent(analysisId)}` : '/intake'}>← Back</a></p>
        </>
      ) : !result ? (
        <div className="card"><h2><span className="spinner dark" /> Assembling your resume…</h2></div>
      ) : (
        <>
          <div className="page-head">
            <div>
              <div className="eyebrow">Approved export · {result.title}</div>
              <h1>Your resume, your call.</h1>
              <p>This version includes only the {result.approved} change{result.approved === 1 ? '' : 's'} you approved.</p>
            </div>
            <span className="status-pill ready">Ready to download</span>
          </div>
          <div className="export-layout">
            <div className="card">
              <h3>Final document</h3>
              <pre className="preview-text plain">{result.content}</pre>
            </div>
            <div className="card stack summary-col">
              <div>
                <h3>Download</h3>
                <div className="summary-row"><span>Approved</span><strong className="green">{result.approved}</strong></div>
                <div className="summary-row"><span>Rejected</span><strong className="red">{result.rejected}</strong></div>
              </div>
              <button className="button primary" onClick={() => download(`${fileBase(result.title)}.doc`, 'application/msword', asHtmlDocument(result.content, result.title))}>Download for Word (.doc) <span>↓</span></button>
              <button className="button secondary" onClick={printPdf}>Save as PDF</button>
              <button className="button secondary" onClick={() => download(`${fileBase(result.title)}.txt`, 'text/plain;charset=utf-8', result.content)}>Download .txt</button>
              <button className="button ghost" onClick={copy}>{copied ? 'Copied ✓' : 'Copy to clipboard'}</button>
              <a className="button ghost" href={`/review?id=${encodeURIComponent(analysisId)}`}>← Change my decisions</a>
              <a className="button ghost" href="/intake">Tailor for another job</a>
            </div>
          </div>
        </>
      )}
    </div></main>
  );
}
