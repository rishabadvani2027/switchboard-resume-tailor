'use client';
import { useEffect, useState } from 'react';
import { loadByok, maskKey, saveByok, type ByokSettings } from '../../lib/byok-client';
import { BYOK_PROVIDERS, type ByokProviderId } from '../../lib/tailoring/byok-providers';

type Mode = 'free' | 'own';
const providerIds = Object.keys(BYOK_PROVIDERS) as ByokProviderId[];

export default function SettingsPage() {
  const [mode, setMode] = useState<Mode>('free');
  const [provider, setProvider] = useState<ByokProviderId>('openai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState<ByokSettings | null>(null);
  const [status, setStatus] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const existing = loadByok();
    if (existing) {
      setSaved(existing);
      setMode('own');
      setProvider(existing.provider);
      setModel(existing.model ?? '');
    }
  }, []);

  const meta = BYOK_PROVIDERS[provider];
  const effectiveKey = apiKey.trim() || (saved?.provider === provider ? saved.apiKey : '');

  async function test(): Promise<boolean> {
    if (!effectiveKey) { setStatus({ kind: 'error', text: 'Paste your API key first.' }); return false; }
    setTesting(true);
    setStatus({ kind: 'info', text: `Checking your key with ${meta.label}…` });
    try {
      const response = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ byok: { provider, apiKey: effectiveKey, model: model.trim() || undefined } }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) { setStatus({ kind: 'success', text: `Key works with ${result.model}.` }); return true; }
      setStatus({ kind: 'error', text: result.error || 'That key could not be verified.' });
      return false;
    } catch {
      setStatus({ kind: 'error', text: 'The key could not be tested. Check your connection.' });
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (mode === 'free') {
      saveByok(null);
      setSaved(null);
      setApiKey('');
      setStatus({ kind: 'success', text: 'Saved. Switchboard’s built-in AI will be used (3 free analyses).' });
      return;
    }
    if (!(await test())) return;
    const settings: ByokSettings = { provider, apiKey: effectiveKey, model: model.trim() || undefined };
    saveByok(settings);
    setSaved(settings);
    setApiKey('');
    setStatus({ kind: 'success', text: `Saved. Analyses will use your ${meta.label} key — unlimited and free on Switchboard.` });
  }

  return (
    <main className="main"><div className="container narrow">
      <div className="page-head"><div>
        <div className="eyebrow">AI settings</div>
        <h1>Choose which AI tailors your resume.</h1>
        <p>Use Switchboard’s built-in AI for your free analyses, or bring your own API key for unlimited tailoring with the model you prefer.</p>
      </div></div>

      <div className="stack">
        <label className={`choice card ${mode === 'free' ? 'selected' : ''}`}>
          <input type="radio" name="mode" checked={mode === 'free'} onChange={() => setMode('free')} />
          <div><h3>Switchboard AI</h3><p>Included — 3 free analyses per account, then the Pro plan.</p></div>
        </label>
        <label className={`choice card ${mode === 'own' ? 'selected' : ''}`}>
          <input type="radio" name="mode" checked={mode === 'own'} onChange={() => setMode('own')} />
          <div><h3>Bring your own key</h3><p>Unlimited analyses. You pay your AI provider directly for what you use (usually a fraction of a cent per resume).</p></div>
        </label>

        {mode === 'own' && (
          <div className="card stack">
            <label><span className="label">Provider</span>
              <select className="input" value={provider} onChange={(e) => { setProvider(e.target.value as ByokProviderId); setModel(''); setStatus(null); }}>
                {providerIds.map((id) => <option key={id} value={id}>{BYOK_PROVIDERS[id].label}</option>)}
              </select>
            </label>
            <label><span className="label">API key</span>
              <input className="input" type="password" autoComplete="off" spellCheck={false} value={apiKey}
                placeholder={saved?.provider === provider ? `Saved: ${maskKey(saved.apiKey)} — paste to replace` : meta.keyHint || 'Paste your API key'}
                onChange={(e) => setApiKey(e.target.value)} />
              <span className="field-note">Get a key at <a className="inline-link" href={meta.keyUrl} target="_blank" rel="noreferrer">{meta.keyUrl.replace('https://', '')}</a>. A ChatGPT or Claude chat subscription does not include API access — the key comes from the developer platform.</span>
            </label>
            <label><span className="label">Model <span className="field-note">(optional)</span></span>
              <input className="input" value={model} placeholder={`Default: ${meta.defaultModel}`} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
            </label>
            <div className="notice info">Your key is stored only in this browser. It is sent securely with each analysis, used for that request, and never saved on our servers.</div>
          </div>
        )}

        {status && <div className={`notice ${status.kind}`} role="status">{status.text}</div>}
        <div className="actions-row">
          {mode === 'own' && <button className="button secondary" onClick={test} disabled={testing}>Test key</button>}
          {saved && mode === 'own' && <button className="button ghost" onClick={() => { setMode('free'); saveByok(null); setSaved(null); setStatus({ kind: 'success', text: 'Your key was removed from this browser.' }); }}>Remove my key</button>}
          <button className="button primary" onClick={save} disabled={testing}>{testing ? 'Checking…' : 'Save'}</button>
        </div>
        <p><a className="inline-link" href="/intake">← Back to workspace</a></p>
      </div>
    </div></main>
  );
}
