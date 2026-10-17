'use client';
import { useState, type ChangeEvent } from 'react';
import { Steps } from '../../components/Steps';
export default function Intake() {
  const [resume, setResume] = useState('Alex Morgan\nProduct designer with 6 years of experience building thoughtful B2B products.\n\nExperience\nNorthstar · Product Designer\nLed discovery, prototyping, and launch of workflow improvements.');
  const [jd, setJd] = useState('We are looking for a senior product designer who can lead discovery, align stakeholders, and ship measurable workflow improvements.');
  const [error, setError] = useState('');
  async function uploadResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('That document is larger than the 5 MB limit.');
      event.target.value = '';
      return;
    }
    const form = new FormData();
    form.set('file', file);
    const response = await fetch('/api/documents', { method: 'POST', body: form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || 'That document could not be uploaded.'); return; }
    setResume(result.text);
    setError('');
  }
  async function analyze() {
    if (!resume.trim() || !jd.trim()) { setError('Add both a resume and a target job description before continuing.'); return; }
    setError('');
    sessionStorage.setItem('resumeText', resume);
    sessionStorage.setItem('jdText', jd);
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resume, jobDescription: jd, idempotencyKey: crypto.randomUUID() }) });
    if (!response.ok) { const result = await response.json().catch(() => ({})); setError(result.error || 'Analysis could not start.'); return; }
    const result = await response.json();
    sessionStorage.setItem('analysisId', result.analysisId);
    window.location.href = '/review';
  }
  return <main className="main"><div className="container"><Steps active={1}/><div className="page-head"><div><div className="eyebrow">Add documents</div><h1>Start with the source material.</h1><p>Paste text or upload a file. Your files stay private to this workspace.</p></div><span className="status-pill ready">Private storage</span></div>{error && <div className="notice error" role="alert">{error}</div>}<div className="grid-2" style={{marginTop:18}}><div className="card stack"><div><h3>Your current resume</h3><p className="field-note">Plain text uploads are extracted now. PDF/DOCX extraction requires a configured server parser.</p></div><label><span className="label">Resume text</span><textarea className="textarea" value={resume} onChange={e=>setResume(e.target.value)} /></label><div className="upload"><strong>Upload resume</strong><div className="field-note">PDF, DOCX, or TXT · max 5 MB</div><input aria-label="Upload resume" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={uploadResume} /></div></div><div className="card stack"><div><h3>Target job description</h3><p className="field-note">Use the complete posting for more relevant suggestions.</p></div><label><span className="label">Job description</span><textarea className="textarea" value={jd} onChange={e=>setJd(e.target.value)} /></label><div className="notice info">We will suggest only changes grounded in your existing experience and this role.</div></div></div><div style={{display:'flex',justifyContent:'flex-end',marginTop:20}}><button className="button primary" onClick={analyze}>Analyze fit <span>→</span></button></div></div></main>;
}
