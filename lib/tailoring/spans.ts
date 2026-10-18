import type { ChangeKind, ResumeChange } from './types';

export type Span = { start: number; end: number };

/** Index of the single occurrence of `needle` in `haystack`, or -1 when missing or ambiguous. */
export function uniqueIndex(haystack: string, needle: string) {
  if (!needle) return -1;
  const first = haystack.indexOf(needle);
  if (first < 0) return -1;
  return haystack.indexOf(needle, first + 1) >= 0 ? -1 : first;
}

const QUOTE_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '–': '-', '—': '-', '−': '-', '•': '•', ' ': ' ',
};

/**
 * Builds a normalized copy of `text` (whitespace collapsed, smart punctuation folded,
 * lower-cased) together with a map from normalized offsets back to source offsets.
 */
function normalizeWithMap(text: string) {
  let normalized = '';
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    let ch = QUOTE_MAP[text[i]] ?? text[i];
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      ch = ' ';
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    normalized += ch.toLowerCase();
    map.push(i);
  }
  return { normalized, map };
}

/**
 * Finds `needle` in `source`, tolerating differences in whitespace, smart quotes,
 * dashes and letter case. Returns the exact source span, or null when missing or ambiguous.
 */
export function locate(source: string, needle: string): Span | null {
  const exact = uniqueIndex(source, needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };
  const trimmed = needle.trim();
  if (!trimmed) return null;
  const exactTrimmed = uniqueIndex(source, trimmed);
  if (exactTrimmed >= 0) return { start: exactTrimmed, end: exactTrimmed + trimmed.length };

  const src = normalizeWithMap(source);
  const ndl = normalizeWithMap(trimmed).normalized.trim();
  if (!ndl) return null;
  const at = uniqueIndex(src.normalized, ndl);
  if (at < 0) return null;
  const start = src.map[at];
  const end = src.map[at + ndl.length - 1] + 1;
  return { start, end };
}

/** Expands a span outwards to cover whole lines. */
export function expandToLines(source: string, span: Span): Span {
  const start = source.lastIndexOf('\n', span.start - 1) + 1;
  const searchFrom = span.end > span.start && source[span.end - 1] === '\n' ? span.end - 1 : span.end;
  const newline = source.indexOf('\n', searchFrom);
  return { start, end: newline < 0 ? source.length : newline };
}

export type RawChange = {
  section?: unknown;
  kind?: unknown;
  original?: unknown;
  proposed?: unknown;
  rationale?: unknown;
};

const clamp = (value: unknown, max: number) => (typeof value === 'string' ? value : '').slice(0, max);

/**
 * Turns untrusted model output into a clean, non-overlapping list of reviewable changes
 * whose `original` text is an exact, unique span of the source. Invalid suggestions are
 * dropped rather than failing the whole analysis.
 */
export function normalizeChanges(source: string, raw: RawChange[]): ResumeChange[] {
  const accepted: Array<ResumeChange & { start: number; lines: Span }> = [];
  for (const candidate of raw.slice(0, 60)) {
    const kindInput = typeof candidate.kind === 'string' ? candidate.kind.toLowerCase() : 'edit';
    let kind: ChangeKind = kindInput === 'addition' || kindInput === 'add' || kindInput === 'insert'
      ? 'addition'
      : kindInput === 'removal' || kindInput === 'remove' || kindInput === 'delete'
        ? 'removal'
        : 'edit';
    const originalInput = clamp(candidate.original, 20_000);
    let proposed = clamp(candidate.proposed, 20_000).replace(/\r\n/g, '\n');
    const span = locate(source, originalInput);
    if (!span) continue;
    const original = source.slice(span.start, span.end);
    if (!original.trim()) continue;

    if (kind === 'removal') proposed = '';
    if (kind === 'edit' && !proposed.trim()) kind = 'removal';
    if (kind === 'edit' && proposed.trim() === original.trim()) continue;
    if (kind === 'addition') {
      // Models sometimes repeat the anchor in the proposed text; keep only the new part.
      if (proposed.startsWith(original)) proposed = proposed.slice(original.length);
      // "Append ', Kubernetes' to this line" is really an edit of the line, not a new line.
      if (/^[ \t]*[,;:&/|·–-]/.test(proposed) && !proposed.includes('\n')) {
        kind = 'edit';
        proposed = `${original}${proposed.replace(/^[ \t]+(?=[,;:])/, '')}`;
      }
    }
    if (kind === 'addition') {
      proposed = proposed.replace(/^\n+/, '').replace(/\s+$/, '');
      if (!proposed.trim()) continue;
    }

    const lines = expandToLines(source, span);
    const overlaps = accepted.some((other) => lines.start <= other.lines.end && other.lines.start <= lines.end);
    if (overlaps) continue;

    accepted.push({
      id: '',
      section: clamp(candidate.section, 200).trim() || 'Resume',
      kind,
      original,
      proposed,
      rationale: clamp(candidate.rationale, 2_000).trim(),
      status: 'pending',
      start: span.start,
      lines,
    });
  }
  return accepted
    .sort((a, b) => a.start - b.start)
    .map(({ start: _start, lines: _lines, ...change }, index) => ({ ...change, id: `chg-${String(index + 1).padStart(3, '0')}` }));
}

/**
 * Flags suggestions that introduce a keyword the model itself listed as missing from the
 * resume (e.g. adding "Kubernetes" to a skills line). These may be untrue, so the reviewer is
 * warned explicitly rather than the suggestion being silently accepted.
 */
export function flagUnsupportedClaims(source: string, changes: ResumeChange[], missingKeywords: string[]): ResumeChange[] {
  const resume = source.toLowerCase();
  const terms = missingKeywords
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !resume.includes(term.toLowerCase()));
  return changes.map((change) => {
    if (change.kind === 'removal') return change;
    const added = change.proposed.toLowerCase();
    const before = change.original.toLowerCase();
    const introduced = terms.filter((term) => {
      const needle = term.toLowerCase();
      return added.includes(needle) && !before.includes(needle);
    });
    if (introduced.length === 0) return change;
    const list = introduced.slice(0, 3).map((term) => `“${term}”`).join(', ');
    const warning = introduced.length === 1
      ? `⚠ Adds ${list}, which isn't on your resume — only approve if it's true.`
      : `⚠ Adds ${list}, which aren't on your resume — only approve if they're true.`;
    return { ...change, rationale: `${warning} ${change.rationale}`.slice(0, 2_000) };
  });
}
