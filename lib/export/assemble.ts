import { resumeChangeSchema, type ResumeChange } from '../tailoring/types';
import { uniqueIndex } from '../tailoring/spans';

export function validateChanges(changes: unknown): ResumeChange[] {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('At least one change is required.');
  const parsed = changes.map((change) => resumeChangeSchema.parse(change));
  const ids = new Set<string>();
  for (const change of parsed) {
    if (ids.has(change.id)) throw new Error('Change identifiers must be unique.');
    ids.add(change.id);
  }
  return parsed;
}

export function canExport(changes: unknown): boolean {
  try {
    return validateChanges(changes).every((change) => change.status !== 'pending');
  } catch {
    return false;
  }
}

/** Text that replaces `change.original` when the change is applied. */
export function replacementFor(change: Pick<ResumeChange, 'kind' | 'original' | 'proposed'>) {
  if (change.kind === 'removal') return '';
  if (change.kind === 'addition') return `${change.original}\n${change.proposed}`;
  return change.proposed;
}

type Located = { change: ResumeChange; start: number; end: number };

export function locateChanges(source: string, changes: ResumeChange[]): Located[] {
  const located = changes.map((change) => {
    const start = uniqueIndex(source, change.original);
    if (start < 0) throw new Error(`Change ${change.id} does not match exactly one source span.`);
    return { change, start, end: start + change.original.length };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < located.length; i += 1) {
    if (located[i].start < located[i - 1].end) throw new Error(`Change ${located[i].change.id} overlaps another change.`);
  }
  return located;
}

/**
 * Applies the approved changes to the source by position. Pending and rejected changes keep
 * the original text. When `includePending` is true, pending changes are also applied (used
 * for "preview if I approve everything").
 */
export function assembleResume(source: string, changes: unknown, options: { includePending?: boolean } = {}): string {
  if (typeof source !== 'string') throw new Error('Source must be text.');
  const located = locateChanges(source, validateChanges(changes));
  let output = '';
  let cursor = 0;
  for (const { change, start, end } of located) {
    const apply = change.status === 'approved' || (options.includePending && change.status === 'pending');
    let segmentStart = start;
    let segmentEnd = end;
    if (apply && change.kind === 'removal') {
      // Removing a whole line should also remove its line break.
      const lineStart = start === 0 || source[start - 1] === '\n';
      const lineEnd = end === source.length || source[end] === '\n';
      if (lineStart && lineEnd) {
        if (source[end] === '\n') segmentEnd = end + 1;
        else if (start > 0 && source[start - 1] === '\n') segmentStart = start - 1;
      }
    }
    segmentStart = Math.max(segmentStart, cursor);
    output += source.slice(cursor, segmentStart);
    output += apply ? replacementFor(change) : source.slice(segmentStart, segmentEnd);
    cursor = segmentEnd;
  }
  return output + source.slice(cursor);
}
