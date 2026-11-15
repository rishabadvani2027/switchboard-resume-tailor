'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Steps } from '../../components/Steps';
import { wordFontName, type PageSize, type StyledLine } from '../../lib/format/styled';

type ExportResult = {
  content: string;
  title: string;
  approved: number;
  rejected: number;
  total: number;
  atsBefore?: number;
  atsAfter?: number;
  sourceFormat?: 'docx' | 'pdf' | 'text';
  originalName?: string | null;
  styled?: StyledLine[];
  page?: PageSize;
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

function fileBase(title: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  return `resume${slug ? `-${slug}` : ''}`;
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const FALLBACK = { serif: "'Times New Roman', Tinos, Georgia, serif", sans: 'Calibri, Carlito, Arial, Helvetica, sans-serif', mono: "'Courier New', monospace" } as const;
const cssFont = (line: StyledLine) => `'${wordFontName(line).replace(/'/g, '')}', ${FALLBACK[line.family]}`;

/** Inline CSS for one line, in points, matching the uploaded file's layout. */
function lineCss(line: StyledLine) {
  return [
    `font-family:${cssFont(line)}`,
    `font-size:${line.size}pt`,
    `font-weight:${line.bold ? 700 : 400}`,
    `font-style:${line.italic ? 'italic' : 'normal'}`,
    `text-align:${line.align}`,
    `margin:${line.gapBefore}pt 0 0 ${line.indent}pt`,
    `line-height:1.2`,
    'white-space:pre-wrap',
  ].join(';');
}

function printableHtml(lines: StyledLine[], page: PageSize, title: string) {
  const body = lines.map((line) => `<p style="${lineCss(line)}">${line.text.trim() ? escapeHtml(line.text) : '&nbsp;'}</p>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: ${page.width}pt ${page.height}pt; margin: ${page.marginTop}pt ${page.marginLeft}pt; }
html, body { margin: 0; padding: 0; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
p { margin: 0; }
</style></head><body>${body}</body></html>`;
}

const PT = 96 / 72;

/** The page rendered at real size, then scaled down to fit the preview column. */
function PaperPreview({ lines, page }: { lines: StyledLine[]; page: PageSize }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [height, setHeight] = useState(page.height * PT);
  useLayoutEffect(() => {
    const update = () => {
      if (!outer.current || !inner.current) return;
      const next = outer.current.clientWidth / (page.width * PT);
      setScale(next);
      setHeight(Math.max(page.height * PT, inner.current.scrollHeight) * next);
    };
    update();
    const observer = new ResizeObserver(update);
    if (outer.current) observer.observe(outer.current);
    return () => observer.disconnect();
  }, [page, lines]);
  return (
    <div ref={outer} className="paper-wrap" style={{ height }}>
      <div ref={inner} className="paper" style={{ width: `${page.width}pt`, minHeight: `${page.height}pt`, padding: `${page.marginTop}pt ${page.marginLeft}pt`, transform: `scale(${scale})` }}>
        {lines.map((line, index) => (
          <p key={index} style={{ fontFamily: cssFont(line), fontSize: `${line.size}pt`, fontWeight: line.bold ? 700 : 400, fontStyle: line.italic ? 'italic' : 'normal', textAlign: line.align, margin: `${line.gapBefore}pt 0 0 ${line.indent}pt`, lineHeight: 1.2, whiteSpace: 'pre-wrap' }}>
            {line.text.trim() ? line.text : '\u00A0'}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function ExportPage() {
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState('');
  const [analysisId, setAnalysisId] = useState('');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [note, setNote] = useState('');

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

  async function downloadWord() {
    if (!result) return;
    setDownloading(true);
    setNote('');
    try {
      const response = await fetch(`/api/exports/file?analysisId=${encodeURIComponent(analysisId)}`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'The Word file could not be created.');
      const notPlaced = Number(response.headers.get('x-changes-not-placed') || 0);
      if (notPlaced > 0) setNote(`${notPlaced} change${notPlaced === 1 ? '' : 's'} couldn’t be matched in your original file (the text was edited after upload) and ${notPlaced === 1 ? 'was' : 'were'} left as in the original.`);
      downloadBlob(`${fileBase(result.title)}.docx`, await response.blob());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The Word file could not be created.');
    } finally {
      setDownloading(false);
    }
  }

  function printPdf() {
    if (!result?.styled || !result.page) return;
    const win = window.open('', '_blank');
    if (!win) { setError('Allow pop-ups to save as PDF.'); return; }
    win.document.write(printableHtml(result.styled, result.page, result.title));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  const format = result?.sourceFormat ?? 'text';
  const formatNote = format === 'docx'
    ? `Your original Word file${result?.originalName ? ` (${result.originalName})` : ''} with only your approved changes — fonts, styles, bullets and spacing unchanged.`
    : format === 'pdf'
      ? `Rebuilt in your PDF’s layout${result?.originalName ? ` (${result.originalName})` : ''}: same fonts, sizes, alignment and spacing.`
      : 'A clean, ATS-friendly layout.';

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
              <div className="card-title-row"><h3>Final document</h3><span className="field-note">{format === 'docx' ? 'Preview — the Word download keeps your exact formatting' : 'Preview of the downloaded layout'}</span></div>
              {result.styled && result.page ? <PaperPreview lines={result.styled} page={result.page} /> : <pre className="preview-text plain">{result.content}</pre>}
            </div>
            <div className="card stack summary-col">
              <div>
                <h3>Download</h3>
                {typeof result.atsAfter === 'number' && (
                  <div className="ats-row compact">
                    <div className="ats-gauge ats-muted"><span className="ats-value">{result.atsBefore}</span><span className="ats-label">ATS before</span></div>
                    <span className="ats-arrow">→</span>
                    <div className={`ats-gauge ats-main ats-${result.atsAfter >= 90 ? 'great' : result.atsAfter >= 75 ? 'good' : result.atsAfter >= 60 ? 'fair' : 'low'}`}><span className="ats-value">{result.atsAfter}</span><span className="ats-label">ATS after</span></div>
                  </div>
                )}
                <div className="summary-row"><span>Approved</span><strong className="green">{result.approved}</strong></div>
                <div className="summary-row"><span>Rejected</span><strong className="red">{result.rejected}</strong></div>
                <p className="field-note">{formatNote}</p>
              </div>
              {note && <div className="notice info">{note}</div>}
              {format === 'pdf' ? (
                <>
                  <button className="button primary" onClick={printPdf}>Download PDF (original layout) <span>↓</span></button>
                  <button className="button secondary" onClick={downloadWord} disabled={downloading}>{downloading ? 'Preparing…' : 'Download Word (.docx)'}</button>
                </>
              ) : (
                <>
                  <button className="button primary" onClick={downloadWord} disabled={downloading}>{downloading ? 'Preparing…' : format === 'docx' ? 'Download Word (original formatting)' : 'Download Word (.docx)'} <span>↓</span></button>
                  <button className="button secondary" onClick={printPdf}>Save as PDF</button>
                </>
              )}
              {format === 'pdf' && <p className="field-note">In the print dialog choose “Save as PDF” and turn off headers and footers.</p>}
              <button className="button ghost" onClick={() => downloadBlob(`${fileBase(result.title)}.txt`, new Blob([result.content], { type: 'text/plain;charset=utf-8' }))}>Download .txt</button>
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
