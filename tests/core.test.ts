import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartOperation, FREE_OPERATIONS } from '../lib/billing/entitlements';
import { assembleResume, canExport } from '../lib/export/assemble';
import { safeRedirectPath } from '../lib/security/redirect';
import { tailoringResultSchema, validateTailoringResult } from '../lib/tailoring/types';
import { validateDocument } from '../lib/documents/validation';
import { MockTailoringProvider } from '../lib/tailoring/provider';
import { getOperationResult, recordCompletedOperation, reserveOperation, saveAnalysis, setSubscriptionStatus, updateChange } from '../lib/server/mock-store';
import { createPkceChallenge, validateOAuthCallback } from '../lib/auth/oauth';

const change = (status: 'pending' | 'approved' | 'rejected') => ({
  id: status,
  section: 'Test',
  kind: 'addition' as const,
  original: 'old',
  proposed: 'new',
  rationale: '',
  status
});

test('export is locked until every change has a decision', () => {
  assert.equal(canExport([change('pending')]), false);
  assert.equal(canExport([change('approved'), change('rejected')]), true);
});

test('assembler includes approved additions and excludes rejected changes', () => {
  const source = 'Built dashboards. Used Figma.';
  const result = assembleResume(source, [
    { id: 'a', section: 'Experience', kind: 'addition', original: 'Built dashboards.', proposed: 'Built dashboards for 3 teams.', rationale: '', status: 'approved' },
    { id: 'b', section: 'Skills', kind: 'addition', original: 'Used Figma.', proposed: 'Used Figma and research.', rationale: '', status: 'rejected' }
  ]);
  assert.equal(result, 'Built dashboards for 3 teams. Used Figma.');
});

test('entitlement allows exactly three free operations', () => {
  assert.equal(FREE_OPERATIONS, 3);
  assert.equal(canStartOperation(2, false), true);
  assert.equal(canStartOperation(3, false), false);
  assert.equal(canStartOperation(99, true), true);
});

test('export assembly rejects ambiguous or malformed changes', () => {
  assert.throws(() => assembleResume('old old', [change('approved')]));
  assert.equal(canExport([{ ...change('approved'), id: 'a' }, { ...change('approved'), id: 'a' }]), false);
});

test('redirects stay on the local origin', () => {
  assert.equal(safeRedirectPath('/review?step=1'), '/review?step=1');
  assert.equal(safeRedirectPath('https://attacker.example/steal'), '/intake');
  assert.equal(safeRedirectPath('//attacker.example/steal'), '/intake');
});

test('OAuth callbacks require matching state and a PKCE verifier', () => {
  const request = (cookie: string) => new Request('https://app.example/auth/callback', { headers: { cookie } });
  assert.equal(validateOAuthCallback(request(''), null), 'oauth-state-missing');
  assert.equal(validateOAuthCallback(request('sb-oauth-state=expected'), 'different'), 'oauth-state-mismatch');
  assert.equal(validateOAuthCallback(request('sb-oauth-state=expected'), 'expected'), 'oauth-verifier-missing');
  assert.equal(validateOAuthCallback(request('sb-oauth-state=expected; sb-code-verifier=verifier'), 'expected'), null);
  assert.equal(createPkceChallenge('verifier'), 'iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ');
});

test('provider output and uploads are validated at the boundary', () => {
  assert.throws(() => tailoringResultSchema.parse({ status: 'ready', changes: [], provider: 'x' }));
  assert.equal(validateDocument({ name: 'resume.txt', type: '', size: 10 }).type, 'text/plain');
  assert.equal(validateDocument({ name: 'resume.txt', type: '', size: 5 * 1024 * 1024 }).size, 5 * 1024 * 1024);
  assert.throws(() => validateDocument({ name: 'resume.txt', type: '', size: 5 * 1024 * 1024 + 1 }));
  assert.throws(() => validateDocument({ name: 'resume.exe', type: '', size: 10 }));
});

test('document validation reads metadata from browser File objects', () => {
  const file = new File(['resume text'], 'resume.txt', { type: 'text/plain' });
  assert.deepEqual(validateDocument(file), {
    name: 'resume.txt',
    type: 'text/plain',
    size: 11,
  });
});

test('provider changes require unique, exact source occurrences and kind semantics', () => {
  const valid = {
    analysisId: 'a',
    status: 'ready' as const,
    provider: 'test',
    changes: [{ id: 'one', section: 'Summary', kind: 'addition' as const, original: 'old', proposed: 'new', rationale: '', status: 'pending' as const }],
  };
  assert.equal(validateTailoringResult(valid, 'old source'), valid);
  assert.throws(() => validateTailoringResult({ ...valid, changes: [{ ...valid.changes[0], id: 'one' }, { ...valid.changes[0], id: 'one' }] }, 'old source'));
  assert.throws(() => validateTailoringResult(valid, 'old old source'));
  assert.throws(() => validateTailoringResult({ ...valid, changes: [{ ...valid.changes[0], kind: 'removal', proposed: 'still here' }] }, 'old source'));
});

test('demo provider changes always match the submitted source', async () => {
  const result = await new MockTailoringProvider().analyze({ resume: 'Custom headline\\nCustom experience', jobDescription: 'Designer' });
  assert.equal(result.status, 'ready');
  assert.ok(result.changes.every((candidate) => 'Custom headline\\nCustom experience'.includes(candidate.original)));
});

test('demo reservations are idempotent and subscription state is server-side', () => {
  const userId = `test-${Date.now()}`;
  assert.equal(reserveOperation(userId, 'one').allowed, true);
  assert.equal(reserveOperation(userId, 'one').alreadyReserved, true);
  setSubscriptionStatus(userId, 'active');
  assert.equal(reserveOperation(userId, 'after-subscription').subscribed, true);
});

test('operation reservations use caller keys rather than submitted content', () => {
  const userId = `test-idempotency-${Date.now()}`;
  const first = reserveOperation(userId, 'caller-key-1');
  const replay = reserveOperation(userId, 'caller-key-1');
  const different = reserveOperation(userId, 'caller-key-2');
  assert.equal(first.alreadyReserved, false);
  assert.equal(replay.alreadyReserved, true);
  assert.equal(different.alreadyReserved, false);
  saveAnalysis({ id: 'analysis-for-key', userId, source: 'source', jobDescription: 'jd', changes: [change('pending')], status: 'ready' });
  recordCompletedOperation(userId, 'caller-key-1', 'analysis-for-key');
  assert.equal(getOperationResult(userId, 'caller-key-1')?.id, 'analysis-for-key');
});

test('change updates cannot cross analysis boundaries', () => {
  const userId = `test-owner-${Date.now()}`;
  const first = { id: 'first', userId, source: 'old', jobDescription: 'jd', changes: [{ ...change('pending'), id: 'first-change' }], status: 'ready' as const };
  const second = { ...first, id: 'second', changes: [{ ...change('pending'), id: 'second-change' }] };
  saveAnalysis(first); saveAnalysis(second);
  assert.equal(updateChange('first', 'second-change', userId, 'approved'), null);
  assert.equal(updateChange('first', 'first-change', userId, 'approved')?.status, 'approved');
});
