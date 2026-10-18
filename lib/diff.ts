import type { ResumeChange } from './tailoring/types';
import { replacementFor } from './export/assemble';
import { expandToLines, uniqueIndex } from './tailoring/spans';

export type DiffOp<T> = { type: 'equal' | 'delete' | 'insert'; value: T };

/** Classic LCS diff. Inputs here are small (resume lines / words), so O(n·m) is fine. */
export function diffSequences<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean = (x, y) => x === y): DiffOp<T>[] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = equals(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: DiffOp<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (equals(a[i], b[j])) { ops.push({ type: 'equal', value: a[i] }); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { ops.push({ type: 'delete', value: a[i] }); i += 1; }
    else { ops.push({ type: 'insert', value: b[j] }); j += 1; }
  }
  while (i < n) { ops.push({ type: 'delete', value: a[i] }); i += 1; }
  while (j < m) { ops.push({ type: 'insert', value: b[j] }); j += 1; }
  return ops;
}

export type Fragment = { text: string; highlight: boolean };
export type DiffLine = { type: 'context' | 'remove' | 'add'; fragments: Fragment[]; oldNumber?: number };

const tokenize = (line: string) => line.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];

/** Word-level highlight for a removed line paired with its replacement line. */
export function wordDiff(oldLine: string, newLine: string): { removed: Fragment[]; added: Fragment[] } {
  const ops = diffSequences(tokenize(oldLine), tokenize(newLine));
  const removed: Fragment[] = [];
  const added: Fragment[] = [];
  const push = (target: Fragment[], text: string, highlight: boolean) => {
    const last = target[target.length - 1];
    if (last && last.highlight === highlight) last.text += text;
    else target.push({ text, highlight });
  };
  for (const op of ops) {
    if (op.type === 'equal') { push(removed, op.value, false); push(added, op.value, false); }
    else if (op.type === 'delete') push(removed, op.value, true);
    else push(added, op.value, true);
  }
  // If almost everything changed, word highlighting is just noise.
  const changedShare = (fragments: Fragment[]) => {
    const total = fragments.reduce((sum, f) => sum + f.text.length, 0) || 1;
    return fragments.filter((f) => f.highlight).reduce((sum, f) => sum + f.text.length, 0) / total;
  };
  if (changedShare(removed) > 0.85 && changedShare(added) > 0.85) {
    return { removed: [{ text: oldLine, highlight: false }], added: [{ text: newLine, highlight: false }] };
  }
  return { removed, added };
}

/** Unified, GitHub-style line diff with intra-line word highlights. */
export function diffLines(oldText: string, newText: string, firstOldLine = 1): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText === '' ? [] : newText.split('\n');
  const ops = diffSequences(oldLines, newLines);
  const output: DiffLine[] = [];
  let oldNumber = firstOldLine;
  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.type === 'equal') {
      output.push({ type: 'context', fragments: [{ text: op.value, highlight: false }], oldNumber });
      oldNumber += 1; index += 1;
      continue;
    }
    const deletes: string[] = [];
    const inserts: string[] = [];
    while (index < ops.length && ops[index].type !== 'equal') {
      if (ops[index].type === 'delete') deletes.push(ops[index].value); else inserts.push(ops[index].value);
      index += 1;
    }
    const removedLines: DiffLine[] = [];
    const addedLines: DiffLine[] = [];
    const pairs = Math.max(deletes.length, inserts.length);
    for (let k = 0; k < pairs; k += 1) {
      const oldLine = deletes[k];
      const newLine = inserts[k];
      if (oldLine !== undefined && newLine !== undefined) {
        const words = wordDiff(oldLine, newLine);
        removedLines.push({ type: 'remove', fragments: words.removed, oldNumber: oldNumber + k });
        addedLines.push({ type: 'add', fragments: words.added });
      } else if (oldLine !== undefined) {
        removedLines.push({ type: 'remove', fragments: [{ text: oldLine, highlight: false }], oldNumber: oldNumber + k });
      } else if (newLine !== undefined) {
        addedLines.push({ type: 'add', fragments: [{ text: newLine, highlight: false }] });
      }
    }
    oldNumber += deletes.length;
    output.push(...removedLines, ...addedLines);
  }
  return output;
}

export type DocumentBlock =
  | { type: 'context'; lines: Array<{ number: number; text: string }> }
  | { type: 'hunk'; change: ResumeChange; lines: DiffLine[] };

/**
 * Splits the source resume into unchanged context blocks and change hunks, so the whole
 * document can be reviewed top-to-bottom like a pull-request file diff.
 */
export function buildDocumentBlocks(source: string, changes: ResumeChange[]): DocumentBlock[] {
  const located = changes
    .map((change) => {
      const start = uniqueIndex(source, change.original);
      return start < 0 ? null : { change, start, end: start + change.original.length };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.start - b.start);

  const blocks: DocumentBlock[] = [];
  let cursor = 0;
  const lineNumberAt = (offset: number) => source.slice(0, offset).split('\n').length;
  const pushContext = (from: number, to: number) => {
    if (to <= from) return;
    let text = source.slice(from, to);
    if (text.endsWith('\n')) text = text.slice(0, -1);
    if (from > 0 && source[from - 1] !== '\n') return;
    const first = lineNumberAt(from);
    blocks.push({ type: 'context', lines: text.split('\n').map((line, i) => ({ number: first + i, text: line })) });
  };

  for (const item of located) {
    const lines = expandToLines(source, item);
    if (lines.start < cursor) {
      // Overlapping legacy data: show the hunk on its own, without merging context.
      blocks.push({ type: 'hunk', change: item.change, lines: diffLines(item.change.original, replacementFor(item.change), lineNumberAt(item.start)) });
      continue;
    }
    pushContext(cursor, lines.start);
    const oldText = source.slice(lines.start, lines.end);
    const newText = source.slice(lines.start, item.start) + replacementFor(item.change) + source.slice(item.end, lines.end);
    const removalOfWholeLines = item.change.kind === 'removal' && !newText.trim();
    blocks.push({ type: 'hunk', change: item.change, lines: diffLines(oldText, removalOfWholeLines ? '' : newText, lineNumberAt(lines.start)) });
    cursor = lines.end + 1;
  }
  if (cursor < source.length) pushContext(cursor, source.length);
  return blocks;
}
