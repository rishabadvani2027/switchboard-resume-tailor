import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartOperation, FREE_OPERATIONS } from '../lib/billing/entitlements';
import { assembleResume, canExport } from '../lib/export/assemble';
import { safeRedirectPath } from '../lib/security/redirect';
import { tailoringResultSchema, validateTailoringResult, type ResumeChange } from '../lib/tailoring/types';
import { validateDocument, cleanExtractedText } from '../lib/documents/validation';
import { getTailoringProvider, MockTailoringProvider } from '../lib/tailoring/provider';
import { locate, normalizeChanges } from '../lib/tailoring/spans';
import { buildDocumentBlocks, diffLines, wordDiff } from '../lib/diff';
import { MemoryStore } from '../lib/server/store';
import { createPkceChallenge, validateOAuthCallback } from '../lib/auth/oauth';

const change = (status: ResumeChange['status'], overrides: Partial<ResumeChange> = {}): ResumeChange => ({
  id: status, section: 'Test', kind: 'edit', original: 'old', proposed: 'new', rationale: '', status, ...overrides,
});

const RESUME = `Priya Sharma
SUMMARY
Backend engineer with 5 years building web services.
EXPERIENCE
- Built REST APIs used by internal teams.
- Worked on database performance.
- Organised the team lunch.
SKILLS
Python, Go`;

test('export is locked until every change has a decision', () => {
  assert.equal(canExport([change('pending')]), false);
  assert.equal(canExport([change('approved', { id: 'a' }), change('rejected', { id: 'b' })]), true);
});

test('assembler applies approved edits, additions and removals and skips rejected ones', () => {
  const result = assembleResume(RESUME, [
    change('approved', { id: 'a', original: 'Built REST APIs used by internal teams.', proposed: 'Designed and shipped REST APIs used by 6 internal teams.' }),
    change('rejected', { id: 'b', original: 'Worked on database performance.', proposed: 'Led database tuning.' }),
    change('approved', { id: 'c', kind: 'removal', original: '- Organised the team lunch.', proposed: '' }),
    change('approved', { id: 'd', kind: 'addition', original: 'Python, Go', proposed: 'PostgreSQL, Docker' }),
  ]);
  assert.equal(result, `Priya Sharma
SUMMARY
Backend engineer with 5 years building web services.
EXPERIENCE
- Designed and shipped REST APIs used by 6 internal teams.
- Worked on database performance.
SKILLS
Python, Go
PostgreSQL, Docker`);
});

test('assembler is position-based, so an approved change cannot create ambiguity for later ones', () => {
  const source = 'alpha\nbeta';
  const result = assembleResume(source, [
    change('approved', { id: 'a', original: 'alpha', proposed: 'beta and alpha' }),
    change('approved', { id: 'b', original: 'beta', proposed: 'gamma' }),
  ]);
  assert.equal(result, 'beta and alpha\ngamma');
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

test('uploads are validated at the boundary', () => {
  assert.throws(() => tailoringResultSchema.parse({ status: 'ready', changes: [], provider: 'x' }));
  assert.equal(validateDocument({ name: 'resume.txt', type: '', size: 10 }).type, 'text/plain');
  assert.equal(validateDocument({ name: 'resume.docx', type: 'application/octet-stream', size: 10 }).type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(validateDocument({ name: 'resume.txt', type: '', size: 5 * 1024 * 1024 }).size, 5 * 1024 * 1024);
  assert.throws(() => validateDocument({ name: 'resume.txt', type: '', size: 5 * 1024 * 1024 + 1 }), /5 MB/);
  assert.throws(() => validateDocument({ name: 'resume.exe', type: '', size: 10 }), /Unsupported/);
  const file = new File(['resume text'], 'resume.txt', { type: 'text/plain' });
  assert.deepEqual(validateDocument(file), { name: 'resume.txt', type: 'text/plain', size: 11 });
  assert.equal(cleanExtractedText('A\r\n\n\n\nB  \n\n-- 1 of 1 --\n'), 'A\n\nB');
});

test('provider results require unique, exact source occurrences and kind semantics', () => {
  const valid = {
    analysisId: 'a', status: 'ready' as const, provider: 'test',
    changes: [{ id: 'one', section: 'Summary', kind: 'edit' as const, original: 'old', proposed: 'new', rationale: '', status: 'pending' as const }],
  };
  assert.equal(validateTailoringResult(valid, 'old source'), valid);
  assert.throws(() => validateTailoringResult({ ...valid, changes: [valid.changes[0], valid.changes[0]] }, 'old source'));
  assert.throws(() => validateTailoringResult(valid, 'old old source'));
  assert.throws(() => validateTailoringResult({ ...valid, changes: [{ ...valid.changes[0], kind: 'removal', proposed: 'still here' }] }, 'old source'));
});

test('model output is matched to the resume despite whitespace, quotes and case differences', () => {
  const source = 'Led the “Atlas” migration —  saving   time.\nOther line';
  const span = locate(source, 'led the "Atlas" migration - saving time.');
  assert.ok(span);
  assert.equal(source.slice(span!.start, span!.end), 'Led the “Atlas” migration —  saving   time.');
  assert.equal(locate('same\nsame', 'same'), null);
});

test('normalizeChanges drops invalid, duplicate-line and no-op suggestions', () => {
  const changes = normalizeChanges(RESUME, [
    { section: 'Experience', kind: 'edit', original: '-  Built REST APIs used by internal teams.', proposed: '- Designed REST APIs.', rationale: 'r' },
    { section: 'Experience', kind: 'edit', original: 'REST APIs', proposed: 'APIs', rationale: 'same line — dropped' },
    { section: 'Experience', kind: 'edit', original: 'Not in the resume', proposed: 'x', rationale: 'missing — dropped' },
    { section: 'Summary', kind: 'edit', original: 'Backend engineer with 5 years building web services.', proposed: 'Backend engineer with 5 years building web services.', rationale: 'no-op — dropped' },
    { section: 'Skills', kind: 'addition', original: 'Python, Go', proposed: 'Python, Go\nPostgreSQL', rationale: 'anchor repeated' },
    { section: 'Experience', kind: 'edit', original: '- Organised the team lunch.', proposed: '', rationale: 'empty edit becomes removal' },
  ]);
  assert.deepEqual(changes.map((c) => [c.id, c.kind, c.original, c.proposed]), [
    ['chg-001', 'edit', '- Built REST APIs used by internal teams.', '- Designed REST APIs.'],
    ['chg-002', 'removal', '- Organised the team lunch.', ''],
    ['chg-003', 'addition', 'Python, Go', 'PostgreSQL'],
  ]);
});

test('diff renders GitHub-style lines with word highlights', () => {
  const words = wordDiff('Built REST APIs for teams', 'Designed REST APIs for 6 teams');
  assert.ok(words.removed.some((f) => f.highlight && f.text.includes('Built')));
  assert.ok(words.added.some((f) => f.highlight && f.text.includes('6')));
  const lines = diffLines('a\nb', 'a\nb\nc', 10);
  assert.deepEqual(lines.map((l) => l.type), ['context', 'context', 'add']);
  assert.equal(lines[1].oldNumber, 11);

  const blocks = buildDocumentBlocks(RESUME, [
    change('pending', { id: 'x', original: 'Worked on database performance.', proposed: 'Tuned PostgreSQL performance.' }),
    change('pending', { id: 'y', kind: 'removal', original: '- Organised the team lunch.', proposed: '' }),
  ]);
  assert.deepEqual(blocks.map((b) => b.type), ['context', 'hunk', 'hunk', 'context']);
  const first = blocks[1];
  assert.ok(first.type === 'hunk' && first.lines.map((l) => l.type).join() === 'remove,add');
  const second = blocks[2];
  assert.ok(second.type === 'hunk' && second.lines.map((l) => l.type).join() === 'remove');
});

test('the offline provider produces changes that match the submitted resume', async () => {
  const result = await new MockTailoringProvider().analyze({ resume: RESUME, jobDescription: 'Payments engineer with kubernetes experience' });
  assert.equal(result.status, 'ready');
  assert.ok(result.changes.length >= 2);
  validateTailoringResult(result, RESUME);
});

test('a configured API key always wins over a leftover mock setting', () => {
  const saved = { ...process.env };
  try {
    process.env.TAILORING_PROVIDER = 'mock';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    assert.match(getTailoringProvider().name, /^anthropic:/);
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    assert.match(getTailoringProvider().name, /^openai:/);
  } finally {
    process.env = saved;
  }
});

test('memory store keeps analyses per user and supports bulk decisions', async () => {
  const store = new MemoryStore(`user-${Date.now()}`);
  const other = new MemoryStore(`other-${Date.now()}`);
  const saved = await store.createAnalysis({
    id: 'analysis-1', idempotencyKey: 'key-1', title: 'Role', source: 'old', jobDescription: 'jd', provider: 'test',
    insights: { summary: '', matchedKeywords: [], missingKeywords: [] },
    changes: [change('pending', { id: 'c1' }), change('pending', { id: 'c2', original: 'x', proposed: 'y' })],
  });
  assert.equal((await store.findByIdempotencyKey('key-1'))?.id, saved.id);
  assert.equal(await other.getAnalysis('analysis-1'), null);
  assert.equal(await store.countCompletedAnalyses(), 1);
  const updated = await store.setChangeStatus('analysis-1', ['c1', 'c2'], 'approved');
  assert.deepEqual(updated?.map((c) => c.status), ['approved', 'approved']);
  assert.equal(await other.setChangeStatus('analysis-1', ['c1'], 'rejected'), null);
});

test('bring-your-own-key input is validated and only known providers are allowed', async () => {
  const { parseByok, createByokProvider, redactSecrets } = await import('../lib/tailoring/provider');
  assert.equal(parseByok(undefined), null);
  assert.throws(() => parseByok({ provider: 'evil', apiKey: 'sk-1234567890' }));
  assert.throws(() => parseByok({ provider: 'openai', apiKey: 'short' }));
  assert.throws(() => parseByok({ provider: 'openai', apiKey: 'sk-1234567890', model: 'bad model; rm' }));
  const config = parseByok({ provider: 'gemini', apiKey: ' AIzaSyTestKey1234567 ' });
  assert.equal(config?.apiKey, 'AIzaSyTestKey1234567');
  assert.equal(createByokProvider(config!).name, 'gemini:gemini-2.5-flash');
  assert.equal(createByokProvider({ provider: 'anthropic', apiKey: 'sk-ant-12345678' }).name, 'anthropic:claude-sonnet-4-5');
  assert.equal(redactSecrets('Incorrect API key provided: sk-proj-abcdef123456'), 'Incorrect API key provided: [redacted]');
});

test('OpenAI-compatible providers fall back when strict JSON schema is unsupported', async () => {
  const { createByokProvider } = await import('../lib/tailoring/provider');
  const originalFetch = globalThis.fetch;
  const formats: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    formats.push(body.response_format?.type ?? 'none');
    if (body.response_format?.type === 'json_schema') return new Response('{"error":"unsupported"}', { status: 400 });
    const content = JSON.stringify({
      summary: 'Good fit', matchedKeywords: ['Python'], missingKeywords: ['Kubernetes'],
      changes: [{ section: 'Experience', kind: 'edit', original: 'Worked on database performance.', proposed: 'Improved PostgreSQL query performance.', rationale: 'JD asks for PostgreSQL.' }],
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await createByokProvider({ provider: 'deepseek', apiKey: 'sk-12345678' }).analyze({ resume: RESUME, jobDescription: 'PostgreSQL' });
    assert.deepEqual(formats, ['json_schema', 'json_object']);
    assert.equal(result.changes[0].proposed, 'Improved PostgreSQL query performance.');
    assert.deepEqual(result.insights?.missingKeywords, ['Kubernetes']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('appending to a line becomes an edit, and unsupported keywords are flagged for the reviewer', async () => {
  const { flagUnsupportedClaims } = await import('../lib/tailoring/spans');
  const [skills] = normalizeChanges(RESUME, [{ section: 'Skills', kind: 'addition', original: 'Python, Go', proposed: ', Kubernetes', rationale: 'JD asks for it' }]);
  assert.equal(skills.kind, 'edit');
  assert.equal(skills.proposed, 'Python, Go, Kubernetes');
  const [flagged] = flagUnsupportedClaims(RESUME, [skills], ['Kubernetes', 'Python']);
  assert.match(flagged.rationale, /^⚠ Adds “Kubernetes”/);
  const [plain] = flagUnsupportedClaims(RESUME, [{ ...skills, proposed: 'Python and Go' }], ['Kubernetes']);
  assert.equal(plain.rationale, 'JD asks for it');
});
