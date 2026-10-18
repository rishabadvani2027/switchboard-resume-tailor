'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Steps } from '../../components/Steps';
import { buildDocumentBlocks, type DiffLine } from '../../lib/diff';
import { assembleResume, canExport } from '../../lib/export/assemble';
import type { ChangeStatus, Insights, ResumeChange } from '../../lib/tailoring/types';

type Analysis = {
  analysisId: string;
  title: string;
  source: string;
  jobDescription: string;
  changes: ResumeChange[];
  insights?: Insights;
  provider: string;
};

const CONTEXT_LINES = 2;

function Line({ line }: { line: DiffLine }) {
  const sign = line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ';
  return (
    <div className={`dl dl-${line.type}`}>
      <span className="dl-num">{line.type === 'add' ? '' : line.oldNumber}</span>
      <span className="dl-sign">{sign}</span>
      <span className="dl-text">
        {line.fragments.map((fragment, index) => (
          fragment.highlight ? <mark key={index}>{fragment.text}</mark> : <Fragment key={index}>{fragment.text}</Fragment>
        ))}
        {line.fragments.every((fragment) => !fragment.text) && ' '}
      </span>
    </div>
  );
}

const kindLabel: Record<ResumeChange['kind'], string> = { edit: 'Rewrite', addition: 'Addition', removal: 'Removal' };

export default function Review() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(0);
  const [view, setView] = useState<'diff' | 'preview'>('diff');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showJd, setShowJd] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let id = params.get('id') || '';
    if (!id) { try { id = sessionStorage.getItem('analysisId') || ''; } catch { /* ignore */ } }
    if (!id) { setError('No analysis was selected. Start from the workspace.'); setLoading(false); return; }
    try { sessionStorage.setItem('analysisId', id); } catch { /* ignore */ }
    if (!params.get('id')) window.history.replaceState(null, '', `/review?id=${encodeURIComponent(id)}`);
    fetch(`/api/analyze?analysisId=${encodeURIComponent(id)}`)
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) { window.location.href = `/signin?error=session-expired&next=${encodeURIComponent(`/review?id=${id}`)}`; return null; }
        if (!response.ok) throw new Error(result.error || 'The analysis could not be loaded.');
        return result as Analysis;
      })
      .then((result) => { if (result) setAnalysis(result); })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  const changes = useMemo(() => analysis?.changes ?? [], [analysis]);
  const counts = useMemo(() => ({
    pending: changes.filter((c) => c.status === 'pending').length,
    approved: changes.filter((c) => c.status === 'approved').length,
    rejected: changes.filter((c) => c.status === 'rejected').length,
  }), [changes]);
  const blocks = useMemo(() => (analysis ? buildDocumentBlocks(analysis.source, changes) : []), [analysis, changes]);
  const preview = useMemo(() => {
    if (!analysis) return '';
    try { return assembleResume(analysis.source, changes); } catch { return analysis.source; }
  }, [analysis, changes]);

  async function decide(body: { changeId?: string; scope?: 'pending' | 'all'; status: ChangeStatus }) {
    if (!analysis) return;
    // Which changes this request touches, decided from the state at click time.
    const ids = analysis.changes
      .filter((change) => (body.changeId ? change.id === body.changeId : body.scope === 'all' || change.status === 'pending'))
      .map((change) => change.id);
    if (ids.length === 0) return;
    const previous = new Map(analysis.changes.filter((c) => ids.includes(c.id)).map((c) => [c.id, c.status]));
    const applyStatuses = (statuses: Map<string, ChangeStatus>) => setAnalysis((current) => (current ? {
      ...current,
      changes: current.changes.map((change) => (statuses.has(change.id) ? { ...change, status: statuses.get(change.id)! } : change)),
    } : current));
    // Optimistic update; each change saves independently so fast clicking never gets lost.
    applyStatuses(new Map(ids.map((id) => [id, body.status])));
    setSaving((count) => count + 1);
    setError('');
    try {
      const response = await fetch('/api/changes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analysisId: analysis.analysisId, changeIds: ids, status: body.status }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Your session expired. Sign in again to keep reviewing.');
      if (!response.ok) throw new Error(result.error || 'That decision could not be saved.');
    } catch (reason) {
      applyStatuses(previous);
      setError(reason instanceof Error ? reason.message : 'That decision could not be saved.');
    } finally {
      setSaving((count) => count - 1);
    }
  }

  const toggle = (change: ResumeChange, status: 'approved' | 'rejected') =>
    decide({ changeId: change.id, status: change.status === status ? 'pending' : status });

  if (loading) {
    return <main className="main"><div className="container"><Steps active={2} /><div className="card"><h2><span className="spinner dark" /> Loading your review…</h2></div></div></main>;
  }
  if (!analysis) {
    return <main className="main"><div className="container"><Steps active={2} /><div className="notice error" role="alert">{error}</div><p><a className="button secondary" href="/intake">← Back to workspace</a></p></div></main>;
  }

  const ready = canExport(changes);
  const progress = changes.length ? Math.round(((counts.approved + counts.rejected) / changes.length) * 100) : 0;

  return (
    <main className="main"><div className="container wide">
      <Steps active={2} />
      <div className="page-head">
        <div>
          <div className="eyebrow">Review changes · {analysis.title}</div>
          <h1>Keep what feels true.</h1>
          <p>Green lines are additions, red lines are removals. Approve or reject each change — only approved changes make it into your resume.</p>
        </div>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}

      <div className="review-layout">
        <section>
          <div className="diff-toolbar">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={view === 'diff'} className={view === 'diff' ? 'active' : ''} onClick={() => setView('diff')}>Changes <span className="count">{changes.length}</span></button>
              <button role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>Preview result</button>
            </div>
            <div className="diff-stats">
              <span className="stat-add">+{changes.filter((c) => c.kind !== 'removal').length}</span>
              <span className="stat-del">−{changes.filter((c) => c.kind !== 'addition').length}</span>
            </div>
          </div>

          {view === 'preview' ? (
            <div className="file-box">
              <div className="file-head"><span>resume.txt — with your approved changes</span></div>
              <pre className="preview-text">{preview}</pre>
            </div>
          ) : (
            <div className="file-box">
              <div className="file-head">
                <span>resume.txt</span>
                <span className="field-note">{counts.pending} of {changes.length} undecided</span>
              </div>
              {blocks.map((block, index) => {
                if (block.type === 'context') {
                  const lines = block.lines;
                  const isFirst = index === 0;
                  const isLast = index === blocks.length - 1;
                  const head = isFirst ? 0 : CONTEXT_LINES;
                  const tail = isLast ? 0 : CONTEXT_LINES;
                  const collapsible = !expanded.has(index) && lines.length > head + tail + 2;
                  if (!collapsible) {
                    return <div key={index}>{lines.map((line) => <Line key={line.number} line={{ type: 'context', oldNumber: line.number, fragments: [{ text: line.text, highlight: false }] }} />)}</div>;
                  }
                  const hidden = lines.length - head - tail;
                  return (
                    <div key={index}>
                      {lines.slice(0, head).map((line) => <Line key={line.number} line={{ type: 'context', oldNumber: line.number, fragments: [{ text: line.text, highlight: false }] }} />)}
                      <button className="expand-row" onClick={() => setExpanded(new Set([...expanded, index]))}>↕ Show {hidden} unchanged {hidden === 1 ? 'line' : 'lines'}</button>
                      {lines.slice(lines.length - tail).map((line) => <Line key={line.number} line={{ type: 'context', oldNumber: line.number, fragments: [{ text: line.text, highlight: false }] }} />)}
                    </div>
                  );
                }
                const { change } = block;
                return (
                  <div key={change.id} className={`hunk hunk-${change.status}`} id={change.id}>
                    <div className="hunk-head">
                      <div className="hunk-meta">
                        <span className={`kind kind-${change.kind}`}>{kindLabel[change.kind]}</span>
                        <strong>{change.section}</strong>
                        {change.rationale && (change.rationale.startsWith('⚠')
                          ? <span className="hunk-warn">{change.rationale}</span>
                          : <span className="hunk-why">— {change.rationale}</span>)}
                      </div>
                      <div className="hunk-actions">
                        <button className={`decision reject ${change.status === 'rejected' ? 'selected' : ''}`} onClick={() => toggle(change, 'rejected')} aria-pressed={change.status === 'rejected'}>✕ Reject</button>
                        <button className={`decision approve ${change.status === 'approved' ? 'selected' : ''}`} onClick={() => toggle(change, 'approved')} aria-pressed={change.status === 'approved'}>✓ Approve</button>
                      </div>
                    </div>
                    <div className="hunk-body">{block.lines.map((line, lineIndex) => <Line key={lineIndex} line={line} />)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="summary-col">
          <div className="card summary">
            <h3>Review summary</h3>
            <div className="progress" aria-label={`${progress}% reviewed`}><span style={{ width: `${progress}%` }} /></div>
            <div className="summary-row"><span>Suggestions</span><strong>{changes.length}</strong></div>
            <div className="summary-row"><span>Approved</span><strong className="green">{counts.approved}</strong></div>
            <div className="summary-row"><span>Rejected</span><strong className="red">{counts.rejected}</strong></div>
            <div className="summary-row"><span>Undecided</span><strong>{counts.pending}</strong></div>
            <div className="bulk-row">
              <button className="button secondary small" disabled={counts.pending === 0} onClick={() => decide({ scope: 'pending', status: 'approved' })}>Approve rest</button>
              <button className="button secondary small" disabled={counts.pending === 0} onClick={() => decide({ scope: 'pending', status: 'rejected' })}>Reject rest</button>
            </div>
            <button className="button primary" style={{ width: '100%', marginTop: 14 }} disabled={!ready || saving > 0} onClick={() => { window.location.href = `/export?id=${encodeURIComponent(analysis.analysisId)}`; }}>Continue to export <span>→</span></button>
            <p className="field-note">{saving > 0 ? 'Saving…' : ready ? 'All changes decided.' : 'Export unlocks once every change is approved or rejected.'}</p>
          </div>

          {analysis.insights && (analysis.insights.summary || analysis.insights.matchedKeywords.length > 0 || analysis.insights.missingKeywords.length > 0) && (
            <div className="card summary insights">
              <h3>Fit for this role</h3>
              {analysis.insights.summary && <p>{analysis.insights.summary}</p>}
              {analysis.insights.matchedKeywords.length > 0 && <><div className="label">Already on your resume</div><div className="chips">{analysis.insights.matchedKeywords.map((k) => <span key={k} className="chip chip-ok">{k}</span>)}</div></>}
              {analysis.insights.missingKeywords.length > 0 && <><div className="label" style={{ marginTop: 12 }}>Asked for, not shown</div><div className="chips">{analysis.insights.missingKeywords.map((k) => <span key={k} className="chip chip-gap">{k}</span>)}</div><p className="field-note">Only add these if you genuinely have the experience.</p></>}
            </div>
          )}

          <div className="card summary">
            <button className="link-button" onClick={() => setShowJd(!showJd)}>{showJd ? 'Hide' : 'Show'} job description</button>
            {showJd && <pre className="jd-text">{analysis.jobDescription}</pre>}
          </div>
        </aside>
      </div>
    </div></main>
  );
}
