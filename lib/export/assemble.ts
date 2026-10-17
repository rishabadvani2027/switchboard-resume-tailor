import { resumeChangeSchema, type ResumeChange } from '../tailoring/types';

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

export function assembleResume(source: string, changes: unknown): string {
  if (typeof source !== 'string') throw new Error('Source must be text.');
  let document = source;
  for (const change of validateChanges(changes)) {
    if (change.status === 'rejected') continue;
    const occurrences = document.split(change.original).length - 1;
    if (occurrences !== 1) throw new Error(`Change ${change.id} does not match exactly one source span.`);
    document = change.kind === 'removal'
      ? document.replace(change.original, '')
      : document.replace(change.original, change.proposed);
  }
  return document;
}
