import { z } from 'zod';

/**
 * A single reviewable change against the source resume.
 *
 * - `edit`     replaces `original` with `proposed`.
 * - `removal`  deletes `original` (proposed is empty).
 * - `addition` keeps `original` (an anchor line) and inserts `proposed` on a new line after it.
 *
 * `original` must always be a verbatim span that occurs exactly once in the source resume.
 */
export const changeKinds = ['edit', 'addition', 'removal'] as const;

export const resumeChangeSchema = z.object({
  id: z.string().min(1).max(100),
  section: z.string().min(1).max(200),
  kind: z.enum(changeKinds),
  original: z.string().min(1).max(20_000),
  proposed: z.string().max(20_000),
  rationale: z.string().max(2_000),
  status: z.enum(['pending', 'approved', 'rejected']),
}).strict().superRefine((change, context) => {
  if (change.kind !== 'removal' && !change.proposed.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['proposed'], message: 'Edits and additions must include proposed text.' });
  }
});

export const insightsSchema = z.object({
  summary: z.string().max(2_000).default(''),
  matchedKeywords: z.array(z.string().max(100)).max(40).default([]),
  missingKeywords: z.array(z.string().max(100)).max(40).default([]),
});

export const tailoringResultSchema = z.object({
  analysisId: z.string().min(1),
  status: z.enum(['ready', 'failed']),
  changes: z.array(resumeChangeSchema).max(100),
  provider: z.string().min(1).max(200),
  insights: insightsSchema.optional(),
}).strict().superRefine((result, context) => {
  if (result.status === 'failed' && result.changes.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes'], message: 'Failed provider results cannot contain reviewable changes.' });
  }
  if (result.status === 'ready' && result.changes.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes'], message: 'Ready provider results must contain at least one change.' });
  }
});

export type ChangeStatus = 'pending' | 'approved' | 'rejected';
export type ChangeKind = typeof changeKinds[number];
export type ResumeChange = z.infer<typeof resumeChangeSchema>;
export type Insights = z.infer<typeof insightsSchema>;
export type TailoringResult = z.infer<typeof tailoringResultSchema>;

export function validateTailoringResult(result: TailoringResult, source: string) {
  const ids = new Set<string>();
  for (const change of result.changes) {
    if (ids.has(change.id)) throw new Error('Provider returned duplicate change IDs.');
    ids.add(change.id);
    const first = source.indexOf(change.original);
    if (first < 0 || first !== source.lastIndexOf(change.original)) {
      throw new Error('Provider change source must match exactly one source occurrence.');
    }
    if (change.kind !== 'removal' && !change.proposed.trim()) {
      throw new Error('Provider edits and additions must include proposed text.');
    }
    if (change.kind === 'removal' && change.proposed.trim()) {
      throw new Error('Provider removals must not include proposed text.');
    }
  }
  if (result.status === 'ready' && result.changes.length === 0) {
    throw new Error('Provider returned no changes for a ready analysis.');
  }
  return result;
}
