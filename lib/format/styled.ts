import { diffSequences } from '../diff';

/** Visual style of one line of a resume, captured from the uploaded file. Units are points. */
export type LineStyle = {
  size: number;
  bold: boolean;
  italic: boolean;
  family: 'serif' | 'sans' | 'mono';
  font?: string;
  align: 'left' | 'center' | 'right';
  indent: number;
  gapBefore: number;
};

export type StyledLine = LineStyle & { text: string };

export type PageSize = { width: number; height: number; marginLeft: number; marginTop: number };

export type DocumentLayout = { page: PageSize; lines: StyledLine[] };

export const A4: PageSize = { width: 595.28, height: 841.89, marginLeft: 54, marginTop: 54 };

const BODY: LineStyle = { size: 10.5, bold: false, italic: false, family: 'sans', align: 'left', indent: 0, gapBefore: 2 };

const norm = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

export const isBullet = (text: string) => /^\s*([-•*▪◦●]|\d+[.)])\s+/.test(text);
const looksLikeHeading = (text: string) => {
  const t = text.trim();
  return t.length > 0 && t.length <= 40 && !/[.,;]$/.test(t) && (t === t.toUpperCase() || /^(summary|profile|experience|education|skills|projects|certifications|awards|languages|contact)\b/i.test(t));
};
export const isHeadingStyle = (style: LineStyle, body: LineStyle) => style.bold && style.size >= body.size;

/** Sensible styles for a pasted (unformatted) resume: big centred name, bold headings, indented bullets. */
export function defaultStyles(lines: string[]): LineStyle[] {
  const firstText = lines.findIndex((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    if (index === firstText) return { ...BODY, size: 18, bold: true, align: 'center', gapBefore: 0 };
    if (index === firstText + 1 && line.trim() && !looksLikeHeading(line)) return { ...BODY, size: 9.5, align: 'center', gapBefore: 2 };
    if (looksLikeHeading(line)) return { ...BODY, size: 11.5, bold: true, gapBefore: 10 };
    if (isBullet(line)) return { ...BODY, indent: 12 };
    return { ...BODY };
  });
}

/** The most common style among non-empty lines (the "body" style). */
export function bodyStyle(styles: LineStyle[], lines: string[]): LineStyle {
  const counts = new Map<string, { style: LineStyle; count: number }>();
  styles.forEach((style, index) => {
    if (!lines[index]?.trim() || style.bold) return;
    const key = `${style.size}|${style.family}|${style.italic}`;
    const entry = counts.get(key) ?? { style, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  });
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.style ?? BODY;
}

/**
 * Assigns each line of the source text the style of the matching line in the uploaded file's
 * layout (matched in order by normalised text). Lines that can't be matched get the style of
 * the nearest matched line before them, or a heuristic default.
 */
export function stylesForSource(sourceLines: string[], layout: StyledLine[] | null | undefined): LineStyle[] {
  const fallback = defaultStyles(sourceLines);
  if (!layout?.length) return fallback;
  const layoutNorm = layout.map((line) => norm(line.text));
  const styles: Array<LineStyle | null> = sourceLines.map(() => null);
  let cursor = 0;
  sourceLines.forEach((line, index) => {
    const target = norm(line);
    if (!target) return;
    for (let probe = cursor; probe < Math.min(layout.length, cursor + 12); probe += 1) {
      if (layoutNorm[probe] === target || (target.length > 12 && (layoutNorm[probe].startsWith(target) || target.startsWith(layoutNorm[probe]) && layoutNorm[probe].length > 12))) {
        const { text: _text, ...style } = layout[probe];
        styles[index] = style;
        cursor = probe + 1;
        return;
      }
    }
  });
  let last: LineStyle | null = null;
  return styles.map((style, index) => {
    if (style) { last = style; return style; }
    if (!sourceLines[index].trim()) return { ...(last ?? fallback[index]), bold: false, gapBefore: 0 };
    return last && !looksLikeHeading(sourceLines[index]) ? { ...last, gapBefore: 2 } : fallback[index];
  });
}

/**
 * Builds the final styled document: the final text's lines, each carrying the style of the
 * original line it came from. Rewritten lines keep their original line's style; brand-new
 * lines borrow the style of a neighbouring body line (never a heading's).
 */
export function styleFinalDocument(sourceText: string, finalText: string, sourceStyles: LineStyle[]): StyledLine[] {
  const sourceLines = sourceText.split('\n');
  const finalLines = finalText.split('\n');
  const body = bodyStyle(sourceStyles, sourceLines);
  const ops = diffSequences(sourceLines.map((line, index) => ({ line, index })), finalLines.map((line) => ({ line, index: -1 })), (a, b) => a.line === b.line);

  const result: StyledLine[] = [];
  let sourceIndex = 0;
  let pendingDeleted: number[] = [];
  const styleFor = (text: string, borrowedFrom: number | undefined): LineStyle => {
    const style = borrowedFrom !== undefined ? sourceStyles[borrowedFrom] : undefined;
    if (!style) return isBullet(text) ? { ...body, indent: Math.max(body.indent, 12) } : body;
    if (isHeadingStyle(style, body) && !looksLikeHeading(text)) {
      // New content placed after a heading should look like body text, not like the heading.
      const nextBody = sourceStyles.slice(borrowedFrom! + 1).find((candidate, offset) => sourceLines[borrowedFrom! + 1 + offset]?.trim() && !isHeadingStyle(candidate, body));
      return { ...(nextBody ?? body), gapBefore: 2 };
    }
    return style;
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      pendingDeleted = [];
      result.push({ ...sourceStyles[op.value.index], text: op.value.line });
      sourceIndex = op.value.index + 1;
    } else if (op.type === 'delete') {
      pendingDeleted.push(op.value.index);
      sourceIndex = op.value.index + 1;
    } else {
      // Inserted line: pair with a deleted line (a rewrite) or borrow from the previous line (an addition).
      const pairedWith = pendingDeleted.shift();
      const borrow = pairedWith ?? Math.max(0, sourceIndex - 1);
      result.push({ ...styleFor(op.value.line, borrow), text: op.value.line });
    }
  }
  return result;
}

const FONT_FOR_FAMILY = { serif: 'Times New Roman', sans: 'Calibri', mono: 'Courier New' } as const;

/** Maps a PDF font name like "Calibri-Bold" or "TimesNewRomanPSMT" to a Word font family name. */
export function wordFontName(line: Pick<StyledLine, 'font' | 'family'>) {
  const raw = (line.font ?? '').replace(/[-,](bold|italic|regular|semibold|medium|light|black|oblique|roman|mt|psmt|bd|it).*$/i, '').replace(/(PSMT|MT|PS)$/,'');
  const spaced = raw.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  if (/^times/i.test(spaced)) return 'Times New Roman';
  if (/^(helvetica|arial)/i.test(spaced)) return 'Arial';
  if (spaced && spaced.length <= 40 && /^[A-Za-z ]+$/.test(spaced)) return spaced;
  return FONT_FOR_FAMILY[line.family];
}

