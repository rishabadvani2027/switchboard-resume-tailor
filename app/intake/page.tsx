'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Steps } from '../../components/Steps';
import { loadByok, type ByokSettings } from '../../lib/byok-client';
import { BYOK_PROVIDERS } from '../../lib/tailoring/byok-providers';

type Summary = { id: string; title: string; createdAt: string; total: number; pending: number };
type Usage = { completed: number; subscribed: boolean };

const SAMPLE_RESUME = `Priya Sharma
Software Engineer · priya@example.com · Bengaluru

SUMMARY
Backend engineer with 5 years of experience building web services in Python and Go.

EXPERIENCE
Acme Corp — Software Engineer (2021–2024)
- Built REST APIs used by internal teams.
- Worked on database performance for the orders service.
- Helped with the on-call rotation.
- Organised the team's monthly lunch.

Nimbus Labs — Junior Developer (2019–2021)
- Wrote Python scripts to automate reporting.

SKILLS
Python, Go, PostgreSQL, Docker`;

const SAMPLE_JD = `Senior Backend Engineer — Payments Platform
We are looking for a backend engineer to design and scale high-throughput APIs for our payments platform.
You will own services end to end, improve PostgreSQL performance, and drive reliability through on-call and incident reviews.
Requirements: 4+ years with Python or Go, distributed systems, PostgreSQL, Docker/Kubernetes, and a track record of mentoring.`;

async function uploadFile(file: File, kind: 'resume' | 'job_description') {
  if (file.size > 5 * 1024 * 1024) throw new Error('That document is larger than the 5 MB limit.');
  const form = new FormData();
  form.set('file', file);
  form.set('kind', kind);
  const response = await fetch('/api/documents', { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'That document could not be uploaded.');
  return result.text as string;
}

export default function Intake() {
  const [resume, setResume] = useState('');
  const [jd, setJd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'resume' | 'jd' | 'analyze'>('');
  const [history, setHistory] = useState<Summary[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [byok, setByok] = useState<ByokSettings | null>(null);
  const requestKey = useRef<string>('');

  useEffect(() => {
    setByok(loadByok());
    try {
      setResume(sessionStorage.getItem('draftResume') ?? '');
      setJd(sessionStorage.getItem('draftJd') ?? '');
    } catch { /* storage unavailable */ }
    fetch('/api/analyze').then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (!data) return;
      setHistory(data.analyses ?? []);
      setUsage({ completed: data.completed ?? 0, subscribed: Boolean(data.subscribed) });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    // A new request key whenever the inputs change; retrying the same inputs reuses the key.
    requestKey.current = '';
    try { sessionStorage.setItem('draftResume', resume); sessionStorage.setItem('draftJd', jd); } catch { /* ignore */ }
  }, [resume, jd]);

  async function onUpload(event: ChangeEvent<HTMLInputElement>, kind: 'resume' | 'job_description') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(kind === 'resume' ? 'resume' : 'jd');
    setError('');
    try {
      const text = await uploadFile(file, kind);
      if (kind === 'resume') setResume(text); else setJd(text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That document could not be uploaded.');
    } finally {
      setBusy('');
    }
  }

  async function analyze() {
    if (!resume.trim() || !jd.trim()) { setError('Add both your resume and the target job description before continuing.'); return; }
    setError('');
    setBusy('analyze');
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resume, jobDescription: jd, idempotencyKey: requestKey.current, byok: byok ?? undefined }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 402) { window.location.href = '/billing?reason=limit'; return; }
      if (response.status === 401) { window.location.href = '/signin?error=session-expired&next=/intake'; return; }
      if (!response.ok) throw new Error(result.error || 'Analysis could not start.');
      window.location.href = `/review?id=${encodeURIComponent(result.analysisId)}`;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Analysis could not start.');
      setBusy('');
    }
  }

  const remaining = usage && !usage.subscribed ? Math.max(0, 3 - usage.completed) : null;

  return (
    <main className="main"><div className="container">
      <Steps active={1} />
      <div className="page-head">
        <div>
          <div className="eyebrow">Add documents</div>
          <h1>Start with the source material.</h1>
          <p>Upload or paste your resume and the job you are applying for.</p>
        </div>
        <div className="ai-badge">
          {byok
            ? <span className="status-pill ready">Your {BYOK_PROVIDERS[byok.provider].label} key · unlimited</span>
            : usage?.subscribed
              ? <span className="status-pill ready">Pro</span>
              : remaining !== null && <span className={`status-pill ${remaining > 0 ? 'ready' : 'pending'}`}>{remaining} free {remaining === 1 ? 'analysis' : 'analyses'} left</span>}
          <a className="inline-link" href="/settings">AI settings</a>
        </div>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card stack">
          <div className="card-title-row"><h3>Your current resume</h3>{!resume && !jd && <button className="button ghost small" type="button" onClick={() => { setResume(SAMPLE_RESUME); setJd(SAMPLE_JD); }}>Try a sample</button>}</div>
          <label className="upload">
            <strong>{busy === 'resume' ? 'Reading your resume…' : 'Upload resume'}</strong>
            <div className="field-note">PDF, DOCX or TXT · max 5 MB</div>
            <input aria-label="Upload resume" type="file" disabled={busy !== ''} accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => onUpload(event, 'resume')} />
          </label>
          <label><span className="label">Resume text</span><textarea className="textarea tall" value={resume} placeholder="…or paste your resume here" onChange={(e) => setResume(e.target.value)} /></label>
          <div className="field-note">{resume.trim() ? `${resume.trim().split(/\s+/).length} words` : 'Tip: check the extracted text looks right before analysing.'}</div>
        </div>
        <div className="card stack">
          <h3>Target job description</h3>
          <label className="upload">
            <strong>{busy === 'jd' ? 'Reading the job description…' : 'Upload job description'}</strong>
            <div className="field-note">Optional — or paste the posting below</div>
            <input aria-label="Upload job description" type="file" disabled={busy !== ''} accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => onUpload(event, 'job_description')} />
          </label>
          <label><span className="label">Job description</span><textarea className="textarea tall" value={jd} placeholder="Paste the complete job posting — title, responsibilities and requirements" onChange={(e) => setJd(e.target.value)} /></label>
          <div className="notice info">Suggestions only rephrase or reorganise what is already in your resume. Nothing is invented, and you approve every change.</div>
        </div>
      </div>
      <div className="actions-row">
        {busy === 'analyze' && <span className="field-note">Tailoring your resume — this usually takes 20–60 seconds…</span>}
        <button className="button primary" onClick={analyze} disabled={busy !== ''}>{busy === 'analyze' ? <><span className="spinner" /> Analysing…</> : <>Analyse fit <span>→</span></>}</button>
      </div>

      {history.length > 0 && (
        <section className="card history" style={{ marginTop: 32 }}>
          <h3>Recent tailoring sessions</h3>
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <a href={`/review?id=${encodeURIComponent(item.id)}`}>
                  <span className="history-title">{item.title || 'Untitled role'}</span>
                  <span className="field-note">{new Date(item.createdAt).toLocaleString()} · {item.total} changes</span>
                </a>
                <span className={`status-pill ${item.pending === 0 ? 'ready' : 'pending'}`}>{item.pending === 0 ? 'Reviewed' : `${item.pending} to review`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div></main>
  );
}
