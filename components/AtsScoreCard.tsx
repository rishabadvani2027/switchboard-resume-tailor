'use client';
import { useMemo, useState } from 'react';
import type { AtsScore } from '../lib/ats/score';

function Gauge({ label, value, tone }: { label: string; value: number; tone: 'muted' | 'main' | 'goal' }) {
  const band = value >= 90 ? 'great' : value >= 75 ? 'good' : value >= 60 ? 'fair' : 'low';
  return (
    <div className={`ats-gauge ats-${tone} ats-${band}`}>
      <span className="ats-value">{value}</span>
      <span className="ats-label">{label}</span>
    </div>
  );
}

export function AtsScoreCard({
  before, now, potential, onAddSkills,
}: {
  before: AtsScore;
  now: AtsScore;
  potential: AtsScore;
  onAddSkills?: (skills: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const missing = potential.missing;
  const gain = useMemo(() => {
    // Rough preview of the score if the picked keywords are added.
    const total = potential.matched.length + potential.missing.length;
    return total ? Math.round((picked.size / total) * 70) : 0;
  }, [picked, potential]);

  async function add() {
    if (!onAddSkills || picked.size === 0) return;
    setAdding(true);
    setError('');
    try {
      await onAddSkills([...picked]);
      setPicked(new Set());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Those skills could not be added.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="card summary ats-card">
      <div className="card-title-row"><h3>ATS match score</h3><button className="link-button" onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}</button></div>
      <div className="ats-row">
        <Gauge label="Before" value={before.score} tone="muted" />
        <span className="ats-arrow">→</span>
        <Gauge label="Now" value={now.score} tone="main" />
        {potential.score !== now.score && <><span className="ats-arrow">⋯</span><Gauge label="If all approved" value={potential.score} tone="goal" /></>}
      </div>
      <p className="field-note">
        {now.score >= 90 ? 'Excellent — your resume matches this job’s keywords strongly.'
          : potential.score >= 90 ? 'Approve the suggestions to reach 90+.'
            : missing.length > 0 ? 'Add job keywords you genuinely have (below) to push past 90.'
              : 'Strengthen sections or add measurable results to raise the score.'}
      </p>

      {open && (
        <div className="ats-checks">
          {now.checks.map((check) => (
            <div key={check.label} className="summary-row"><span>{check.label}<span className="field-note"> · {check.detail}</span></span><strong>{Math.round(check.points)}/{check.max}</strong></div>
          ))}
          <p className="field-note">An estimate of how applicant tracking systems read your resume: mostly literal keyword matching plus basic structure checks. Real ATS tools vary.</p>
        </div>
      )}

      {missing.length > 0 && onAddSkills && (
        <div className="ats-missing">
          <div className="label">Job keywords still missing</div>
          <p className="field-note">Tick only the ones you genuinely have — they’ll be added to your skills line.</p>
          <div className="chips">
            {missing.map((keyword) => (
              <label key={keyword} className={`chip chip-pick ${picked.has(keyword) ? 'on' : ''}`}>
                <input type="checkbox" checked={picked.has(keyword)} onChange={() => {
                  const next = new Set(picked);
                  if (next.has(keyword)) next.delete(keyword); else next.add(keyword);
                  setPicked(next);
                }} />
                {keyword}
              </label>
            ))}
          </div>
          {error && <div className="notice error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
          <button className="button secondary small" style={{ width: '100%', marginTop: 10 }} disabled={picked.size === 0 || adding} onClick={add}>
            {adding ? 'Adding…' : picked.size ? `Add ${picked.size} skill${picked.size === 1 ? '' : 's'} I have (≈ +${gain})` : 'Select skills you have'}
          </button>
        </div>
      )}
    </div>
  );
}
