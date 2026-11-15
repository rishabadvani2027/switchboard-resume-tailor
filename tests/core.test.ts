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

test('analyses run with the user\'s own key do not use up the free allowance', async () => {
  const store = new MemoryStore(`byok-${Date.now()}`);
  const base = { title: 'Role', source: 'old', jobDescription: 'jd', provider: 'test', insights: { summary: '', matchedKeywords: [], missingKeywords: [] }, changes: [change('pending')] };
  await store.createAnalysis({ ...base, id: `a-${Date.now()}`, idempotencyKey: 'k1' });
  await store.createAnalysis({ ...base, id: `b-${Date.now()}`, idempotencyKey: 'k2', usesOwnKey: true });
  assert.equal(await store.countCompletedAnalyses(), 1);
});

test('Dodo webhooks are verified with the Standard Webhooks signature scheme', async () => {
  const { createHmac } = await import('node:crypto');
  const { verifyWebhook } = await import('../lib/billing/dodo');
  const rawKey = Buffer.from('super-secret-signing-key-123456');
  const secret = `whsec_${rawKey.toString('base64')}`;
  const body = JSON.stringify({ type: 'subscription.active', data: { subscription_id: 'sub_1' } });
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const sign = (content: string) => createHmac('sha256', rawKey).update(content).digest('base64');
  const headers = (signature: string, ts = timestamp) => new Headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': signature });
  assert.equal(verifyWebhook(body, headers(`v1,${sign(`msg_1.${timestamp}.${body}`)}`), secret, now), true);
  assert.equal(verifyWebhook(body, headers(`v1,bogus v1,${sign(`msg_1.${timestamp}.${body}`)}`), secret, now), true);
  assert.equal(verifyWebhook(`${body} `, headers(`v1,${sign(`msg_1.${timestamp}.${body}`)}`), secret, now), false);
  assert.equal(verifyWebhook(body, headers(`v1,${sign(`msg_1.${timestamp}.${body}`)}`), `whsec_${Buffer.from('wrong').toString('base64')}`, now), false);
  const old = String(Math.floor(now / 1000) - 600);
  assert.equal(verifyWebhook(body, headers(`v1,${sign(`msg_1.${old}.${body}`)}`, old), secret, now), false);
});

test('subscription status mapping and access rules', async () => {
  const { statusFromEvent, subscriptionGrantsAccess } = await import('../lib/billing/dodo');
  const event = (type: string) => ({ type, data: {} });
  assert.equal(statusFromEvent(event('subscription.active')), 'active');
  assert.equal(statusFromEvent(event('subscription.renewed')), 'active');
  assert.equal(statusFromEvent(event('subscription.on_hold')), 'on_hold');
  assert.equal(statusFromEvent(event('payment.succeeded')), null);
  const now = Date.parse('2026-11-15T00:00:00Z');
  assert.equal(subscriptionGrantsAccess({ status: 'active' }, now), true);
  assert.equal(subscriptionGrantsAccess({ status: 'past_due' }, now), true);
  assert.equal(subscriptionGrantsAccess({ status: 'on_hold' }, now), false);
  assert.equal(subscriptionGrantsAccess({ status: 'cancelled', current_period_end: '2026-12-01T00:00:00Z' }, now), true);
  assert.equal(subscriptionGrantsAccess({ status: 'cancelled', current_period_end: '2026-11-01T00:00:00Z' }, now), false);
});

test('a one-time Pro purchase grants lifetime access; a refund removes it', async () => {
  const { subscriptionGrantsAccess } = await import('../lib/billing/dodo');
  assert.equal(subscriptionGrantsAccess({ status: 'lifetime' }), true);
  assert.equal(subscriptionGrantsAccess({ status: 'refunded' }), false);
});

const SAMPLE_CV = `Priya Sharma
Software Engineer · priya@example.com · +91 98765 43210 · Bengaluru

SUMMARY
Backend engineer with 5 years of experience building web services in Python and Go.

EXPERIENCE
Acme Corp — Software Engineer (2021–2024)
- Built REST APIs used by internal teams.
- Worked on database performance for the orders service.
- Helped with the on-call rotation.

EDUCATION
B.Tech, Computer Science — VIT (2019)

SKILLS
Python, Go, PostgreSQL, Docker`;
const SAMPLE_JOB = `Senior Backend Engineer — Payments Platform
Design and scale high-throughput APIs. Improve PostgreSQL performance. Kubernetes, mentoring.`;
const SAMPLE_KEYWORDS = ['Python', 'Go', 'PostgreSQL', 'Docker', 'APIs', 'backend engineer', 'Kubernetes', 'distributed systems', 'mentoring', 'high-throughput APIs', 'incident reviews'];

test('ATS score is deterministic and rewards keyword coverage', async () => {
  const { scoreResume, containsKeyword } = await import('../lib/ats/score');
  assert.equal(containsKeyword('built rest apis with postgresql', 'PostgreSQL'), true);
  assert.equal(containsKeyword('go developer', 'Go'), true);
  assert.equal(containsKeyword('good engineer', 'Go'), false);
  assert.equal(containsKeyword('designed high throughput rest apis', 'high-throughput APIs'), true);
  const first = scoreResume(SAMPLE_CV, SAMPLE_JOB, SAMPLE_KEYWORDS);
  assert.deepEqual(scoreResume(SAMPLE_CV, SAMPLE_JOB, SAMPLE_KEYWORDS), first);
  assert.deepEqual(first.missing.sort(), ['Kubernetes', 'distributed systems', 'high-throughput APIs', 'incident reviews', 'mentoring'].sort());
  assert.ok(first.score < 80, `before score ${first.score}`);
});

test('adding confirmed skills goes on the skills line and lifts the sample past 90', async () => {
  const { scoreResume } = await import('../lib/ats/score');
  const { buildSkillsChange } = await import('../lib/ats/add-skills');
  const before = scoreResume(SAMPLE_CV, SAMPLE_JOB, SAMPLE_KEYWORDS);
  const add = buildSkillsChange(SAMPLE_CV, [], before.missing, 'chg-u01');
  assert.ok(add);
  assert.equal(add!.kind, 'edit');
  assert.equal(add!.original, 'Python, Go, PostgreSQL, Docker');
  const after = assembleResume(SAMPLE_CV, [add!]);
  const score = scoreResume(after, SAMPLE_JOB, SAMPLE_KEYWORDS).score;
  assert.ok(score >= 90, `after score ${score}`);

  // If the skills line already has a pending change, insert after the heading instead.
  const taken = { ...change('pending'), id: 'x', original: 'Python, Go, PostgreSQL, Docker', proposed: 'Python, Go' };
  const alt = buildSkillsChange(SAMPLE_CV, [taken], ['Kubernetes'], 'chg-u02');
  assert.equal(alt?.kind, 'addition');
  assert.equal(alt?.original, 'SKILLS');
  assert.doesNotThrow(() => assembleResume(SAMPLE_CV, [{ ...taken, status: 'approved' }, alt!]));
});

test('ATS keywords must come from the job and match common word forms', async () => {
  const { containsKeyword, jobKeywords } = await import('../lib/ats/score');
  assert.equal(containsKeyword('designed restful apis', 'REST APIs'), true);
  assert.equal(containsKeyword('scaling web services', 'scale'), true);
  assert.equal(containsKeyword('c++ and go', 'C++'), true);
  assert.equal(containsKeyword('good engineer', 'Go'), false);
  const jd = 'Backend engineer. Python, Go, PostgreSQL, Docker, Kubernetes, distributed systems, mentoring.';
  const keywords = jobKeywords(jd, { matchedKeywords: ['Python', 'Go', 'REST APIs', 'database performance'], missingKeywords: ['Kubernetes', 'distributed systems', 'mentoring', 'Docker'] });
  assert.ok(!keywords.includes('REST APIs'));
  assert.ok(!keywords.includes('database performance'));
  assert.ok(keywords.includes('Kubernetes'));
});

test('a new bullet suggested after an existing one stays on its own line', () => {
  const [bullet] = normalizeChanges(RESUME, [{ section: 'Experience', kind: 'addition', original: '- Organised the team lunch.', proposed: '- Mentored two junior engineers.', rationale: 'r' }]);
  assert.equal(bullet.kind, 'addition');
  const out = assembleResume(RESUME, [{ ...bullet, status: 'approved' }]);
  assert.ok(out.includes('- Organised the team lunch.\n- Mentored two junior engineers.'));
});

test('final lines inherit the uploaded layout: rewrites keep their style, new lines copy neighbours', async () => {
  const { styleFinalDocument, stylesForSource } = await import('../lib/format/styled');
  const source = 'Priya Sharma\nSUMMARY\nBackend engineer.\nSKILLS\nPython, Go';
  const base = { italic: false, family: 'serif' as const, align: 'left' as const, indent: 0, gapBefore: 2 };
  const layout = [
    { ...base, text: 'Priya Sharma', size: 20, bold: true, align: 'center' as const },
    { ...base, text: 'SUMMARY', size: 12, bold: true },
    { ...base, text: 'Backend engineer.', size: 11, bold: false },
    { ...base, text: 'SKILLS', size: 12, bold: true },
    { ...base, text: 'Python, Go', size: 11, bold: false },
  ];
  const finalText = 'Priya Sharma\nSUMMARY\nBackend engineer building high-throughput APIs.\nSKILLS\nKubernetes\nPython, Go';
  const styled = styleFinalDocument(source, finalText, stylesForSource(source.split('\n'), layout));
  assert.deepEqual(styled.map((line) => [line.text, line.size, line.bold, line.align]), [
    ['Priya Sharma', 20, true, 'center'],
    ['SUMMARY', 12, true, 'left'],
    ['Backend engineer building high-throughput APIs.', 11, false, 'left'],
    ['SKILLS', 12, true, 'left'],
    ['Kubernetes', 11, false, 'left'],
    ['Python, Go', 11, false, 'left'],
  ]);
});

test('approved changes are applied inside the original Word file, keeping run formatting', async () => {
  const JSZip = (await import('jszip')).default;
  const { applyChangesToDocx } = await import('../lib/format/docx-edit');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (inner: string, pPr = '') => `<w:p>${pPr}${inner}</w:p>`;
  const r = (text: string, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const bullet = '<w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>';
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>`
    + p(r('Acme Corp', '<w:rPr><w:b/></w:rPr>') + r(' — Software Engineer'))
    + p(r('Built REST ') + r('APIs', '<w:rPr><w:i/></w:rPr>') + r(' used by internal teams.'), bullet)
    + p(r('Organised the team lunch.'), bullet)
    + p(r('SKILLS', '<w:rPr><w:b/></w:rPr>'), '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>')
    + p(r('Python, Go'))
    + '</w:body></w:document>';
  const zip = new JSZip();
  zip.file('word/document.xml', xml);
  const original = await zip.generateAsync({ type: 'arraybuffer' });
  const c = (id: string, kind: ResumeChange['kind'], original: string, proposed: string): ResumeChange => ({ id, section: 's', kind, original, proposed, rationale: '', status: 'approved' });
  const result = await applyChangesToDocx(original, [
    c('a', 'edit', 'Built REST APIs used by internal teams.', '- Built REST APIs used by 6 internal teams.'),
    c('b', 'removal', 'Organised the team lunch.', ''),
    c('c', 'addition', 'SKILLS', 'Kubernetes'),
    c('d', 'edit', 'Python, Go', 'Python, Go, Docker'),
    { ...c('e', 'edit', 'Acme Corp', 'Beta Corp'), status: 'rejected' },
  ]);
  assert.equal(result.applied, 4);
  assert.deepEqual(result.skipped, []);
  const out = await (await JSZip.loadAsync(result.file)).file('word/document.xml')!.async('string');
  assert.ok(out.includes('<w:b/></w:rPr><w:t xml:space="preserve">Acme Corp</w:t>'), 'bold run untouched');
  assert.ok(out.includes('<w:i/></w:rPr><w:t xml:space="preserve">APIs</w:t>'), 'italic word kept');
  assert.ok(out.includes('used by 6 internal teams.'));
  assert.ok(!out.includes('- Built'), 'no duplicate bullet dash in a Word list');
  assert.ok(!out.includes('Organised'), 'removed paragraph is gone');
  assert.ok(/SKILLS.*Kubernetes.*Python, Go, Docker/s.test(out.replace(/<[^>]+>/g, '')), 'new line inserted after the heading');
  const kubernetesParagraph = out.slice(out.lastIndexOf('<w:p>', out.indexOf('Kubernetes')), out.indexOf('Kubernetes'));
  assert.ok(!kubernetesParagraph.includes('Heading2'), 'new line uses body formatting, not the heading style');
});
