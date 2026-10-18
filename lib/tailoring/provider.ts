import { BYOK_PROVIDERS, type ByokProviderId } from './byok-providers';
import { normalizeChanges, type RawChange } from './spans';
import { insightsSchema, tailoringResultSchema, type Insights, type TailoringResult } from './types';

export type TailoringInput = { resume: string; jobDescription: string };

export interface TailoringProvider {
  readonly name: string;
  analyze(input: TailoringInput): Promise<TailoringResult>;
}

export class TailoringError extends Error {
  constructor(message: string, readonly userMessage = 'The tailoring service could not complete this analysis. Please try again.') {
    super(message);
  }
}

const SYSTEM_PROMPT = `You are an expert resume writer and career coach who helps people tailor an existing resume to a specific job description.

You propose a focused set of small, reviewable changes. The candidate will approve or reject each change individually, like reviewing a pull request.

Hard rules — never break these:
- Never invent experience, employers, job titles, dates, degrees, certifications, tools, or metrics that are not supported by the resume. You may rephrase, reorder emphasis, use the job description's vocabulary for things the candidate already did, tighten wording, and remove content that is irrelevant to this role.
- If a number would strengthen a bullet but none exists in the resume, do not make one up.
- "original" MUST be copied character-for-character from the resume (same spelling, punctuation and capitalisation). Prefer one complete line or bullet. It must appear exactly once in the resume.
- Each change must touch a different line. Never propose two changes for the same line.
- Keep the candidate's voice, tense and formatting conventions (bullet characters, separators).

Change kinds:
- "edit": replace "original" with "proposed" (rewrite a bullet, headline, summary sentence or skills line).
- "addition": keep "original" exactly as is and insert "proposed" as a NEW line directly after it (e.g. a new skill line or a new bullet that is clearly supported by existing content). "proposed" contains only the new line(s).
- "removal": delete "original" because it is irrelevant or weakens the application for this role. "proposed" must be "".

Aim for 6–14 high-impact changes, prioritising the summary/headline, the most recent role, and the skills section.
Every change needs a short "rationale" (max ~25 words) that cites the job requirement it serves.`;

function userPrompt(input: TailoringInput) {
  return `<job_description>\n${input.jobDescription.trim()}\n</job_description>\n\n<resume>\n${input.resume}\n</resume>\n\nPropose tailored changes for this resume and job description. Also list the job's important keywords already evidenced in the resume (matchedKeywords) and important keywords the resume does not show (missingKeywords), plus a 1–2 sentence summary of fit.`;
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '1–2 sentence assessment of how well the resume fits the role.' },
    matchedKeywords: { type: 'array', items: { type: 'string' }, description: 'Up to 15 job keywords already evidenced in the resume.' },
    missingKeywords: { type: 'array', items: { type: 'string' }, description: 'Up to 15 important job keywords the resume does not show.' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Resume section, e.g. Summary, Experience — Acme, Skills.' },
          kind: { type: 'string', enum: ['edit', 'addition', 'removal'] },
          original: { type: 'string', description: 'Verbatim text copied from the resume.' },
          proposed: { type: 'string', description: 'Replacement text (edit), new line(s) to insert (addition), or empty (removal).' },
          rationale: { type: 'string' },
        },
        required: ['section', 'kind', 'original', 'proposed', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'matchedKeywords', 'missingKeywords', 'changes'],
  additionalProperties: false,
} as const;

type ModelOutput = { summary?: unknown; matchedKeywords?: unknown; missingKeywords?: unknown; changes?: unknown };

function toResult(provider: string, input: TailoringInput, output: ModelOutput): TailoringResult {
  const rawChanges = Array.isArray(output.changes) ? output.changes as RawChange[] : [];
  const changes = normalizeChanges(input.resume, rawChanges);
  if (changes.length === 0) {
    throw new TailoringError(
      `Model returned ${rawChanges.length} changes but none matched the resume text.`,
      'We could not produce changes that match your resume text. Check that the resume is plain text with readable content, then try again.',
    );
  }
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => v.slice(0, 100)).slice(0, 20) : []);
  const insights: Insights = insightsSchema.parse({
    summary: typeof output.summary === 'string' ? output.summary.slice(0, 2_000) : '',
    matchedKeywords: strings(output.matchedKeywords),
    missingKeywords: strings(output.missingKeywords),
  });
  return tailoringResultSchema.parse({ analysisId: crypto.randomUUID(), status: 'ready', changes, provider, insights });
}

const SECRET_PATTERN = /(sk-[A-Za-z0-9_-]{6,}|AIza[0-9A-Za-z_-]{10,}|gsk_[A-Za-z0-9]{10,}|Bearer\s+\S+)/g;
/** Never let an API key end up in logs or error messages. */
export const redactSecrets = (text: string) => text.replace(SECRET_PATTERN, '[redacted]');

async function readError(response: Response) {
  const text = await response.text().catch(() => '');
  return `${response.status} ${redactSecrets(text.slice(0, 500))}`;
}

function extractJson(text: string): ModelOutput {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(candidate) as ModelOutput; } catch { throw new TailoringError('Model output was not valid JSON.', 'The AI returned an unreadable answer. Please try again, or pick a more capable model.'); }
}

const TIMEOUT_MS = 110_000;

function friendlyHttpError(provider: string, status: number, keySource: KeySource) {
  if (status === 401 || status === 403) {
    return keySource === 'user'
      ? `${provider} rejected your API key. Check the key in AI settings.`
      : 'The AI provider rejected the server API key. Ask the site owner to check it.';
  }
  if (status === 404) return `${provider} does not recognise that model name. Check the model in AI settings.`;
  if (status === 402) {
    return keySource === 'user'
      ? `${provider} says your account is out of credit. Add credit with ${provider} or use another key.`
      : 'The built-in AI has run out of credit. Add your own AI key in AI settings, or try again later.';
  }
  if (status === 429) {
    return keySource === 'user'
      ? `${provider} is rate-limiting your key. Wait a minute and try again.`
      : 'The AI service is busy right now. Please try again in a minute.';
  }
  if (status >= 500) return `${provider} is having problems right now. Please try again shortly.`;
  return undefined;
}

async function callWithTimeout(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new TailoringError(`AI request failed: ${String(error)}`, timedOut
      ? 'The AI took too long to respond. Try again, or use a faster model.'
      : 'Could not reach the AI provider. Please try again.');
  }
}

export type KeySource = 'server' | 'user';

export class AnthropicTailoringProvider implements TailoringProvider {
  readonly name: string;
  constructor(private apiKey: string, private model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', private keySource: KeySource = 'server') {
    this.name = `anthropic:${this.model}`;
  }

  async analyze(input: TailoringInput) {
    const response = await callWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        tools: [{ name: 'submit_tailoring', description: 'Submit the tailored resume changes.', input_schema: OUTPUT_SCHEMA }],
        tool_choice: { type: 'tool', name: 'submit_tailoring' },
        messages: [{ role: 'user', content: userPrompt(input) }],
      }),
    });
    if (!response.ok) {
      throw new TailoringError(`Anthropic API error: ${await readError(response)}`, friendlyHttpError('Anthropic', response.status, this.keySource));
    }
    const body = await response.json() as { content?: Array<{ type: string; input?: unknown; text?: string }> };
    const toolUse = body.content?.find((block) => block.type === 'tool_use');
    if (toolUse?.input && typeof toolUse.input === 'object') return toResult(this.name, input, toolUse.input as ModelOutput);
    const text = body.content?.filter((block) => block.type === 'text').map((block) => block.text).join('\n') ?? '';
    return toResult(this.name, input, extractJson(text));
  }
}

const JSON_INSTRUCTIONS = `\n\nRespond with a single JSON object only (no prose, no markdown fences) matching this JSON Schema:\n${JSON.stringify(OUTPUT_SCHEMA)}`;

/** Any provider that speaks the OpenAI Chat Completions API (OpenAI, Gemini, OpenRouter, Groq, …). */
export class OpenAICompatibleProvider implements TailoringProvider {
  readonly name: string;
  constructor(
    private options: { label: string; slug: string; baseUrl: string; apiKey: string; model: string; keySource: KeySource; extraHeaders?: Record<string, string> },
  ) {
    this.name = `${options.slug}:${options.model}`;
  }

  private async request(input: TailoringInput, mode: 'schema' | 'object' | 'plain') {
    const isOpenRouter = this.options.baseUrl.includes('openrouter.ai');
    const responseFormat = mode === 'schema'
      ? { response_format: { type: 'json_schema', json_schema: { name: 'tailoring', strict: true, schema: OUTPUT_SCHEMA } } }
      : mode === 'object' ? { response_format: { type: 'json_object' } } : {};
    return callWithTimeout(`${this.options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
        ...(isOpenRouter ? { 'HTTP-Referer': 'https://switchboardapp.studio', 'X-Title': 'Switchboard' } : {}),
        ...this.options.extraHeaders,
      },
      body: JSON.stringify({
        model: this.options.model,
        // Without a cap, some gateways (e.g. OpenRouter) reserve the model's full output budget
        // and reject the request when the account balance is low.
        max_tokens: 8000,
        ...responseFormat,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(input) + (mode === 'schema' ? '' : JSON_INSTRUCTIONS) },
        ],
      }),
    });
  }

  async analyze(input: TailoringInput) {
    // Not every provider/model supports strict JSON schemas, so degrade gracefully.
    let response = await this.request(input, 'schema');
    for (const fallback of ['object', 'plain'] as const) {
      if (response.status !== 400 && response.status !== 422) break;
      console.warn(`[tailoring] ${this.name} rejected the request (${await readError(response)}); retrying with ${fallback} output`);
      response = await this.request(input, fallback);
    }
    if (!response.ok) {
      throw new TailoringError(`${this.options.label} API error: ${await readError(response)}`, friendlyHttpError(this.options.label, response.status, this.options.keySource));
    }
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return toResult(this.name, input, extractJson(body.choices?.[0]?.message?.content ?? ''));
  }
}

/* ------------------------------------------------------------ bring-your-own-key */

export { BYOK_PROVIDERS, type ByokProviderId };
export type ByokConfig = { provider: ByokProviderId; apiKey: string; model?: string };

/** Validates an untrusted BYOK payload. Only known provider endpoints are allowed (no custom URLs). */
export function parseByok(value: unknown): ByokConfig | null {
  if (!value || typeof value !== 'object') return null;
  const { provider, apiKey, model } = value as Record<string, unknown>;
  if (typeof provider !== 'string' || !(provider in BYOK_PROVIDERS)) throw new TailoringError('Unknown AI provider.', 'Choose a supported AI provider in AI settings.');
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 400 || /\s/.test(apiKey.trim())) {
    throw new TailoringError('Invalid BYOK key.', 'Your API key looks invalid. Paste it again in AI settings.');
  }
  if (model !== undefined && (typeof model !== 'string' || model.length > 120 || !/^[\w.:/@-]*$/.test(model))) {
    throw new TailoringError('Invalid model.', 'That model name looks invalid.');
  }
  return { provider: provider as ByokProviderId, apiKey: apiKey.trim(), model: typeof model === 'string' && model.trim() ? model.trim() : undefined };
}

export function createByokProvider(config: ByokConfig): TailoringProvider {
  const meta = BYOK_PROVIDERS[config.provider];
  const model = config.model || meta.defaultModel;
  if (config.provider === 'anthropic') return new AnthropicTailoringProvider(config.apiKey, model, 'user');
  return new OpenAICompatibleProvider({
    label: meta.label.replace(/ \(.*\)$/, ''),
    slug: config.provider,
    baseUrl: meta.baseUrl,
    apiKey: config.apiKey,
    model,
    keySource: 'user',
    extraHeaders: config.provider === 'openrouter' ? { 'HTTP-Referer': 'https://switchboardapp.studio', 'X-Title': 'Switchboard' } : undefined,
  });
}

/**
 * Offline provider used for local development and tests when no AI key is configured.
 * It makes simple, deterministic suggestions so the review flow can be exercised end to end.
 */
export class MockTailoringProvider implements TailoringProvider {
  readonly name = 'mock';

  async analyze(input: TailoringInput) {
    const jdWords = new Set((input.jobDescription.toLowerCase().match(/[a-z][a-z+#.-]{3,}/g) ?? []));
    const lines = input.resume.split('\n').map((line) => line.trim()).filter((line) => line.length > 3);
    const raw: RawChange[] = [];
    const weak = lines.find((line) => /^(?:[-•*]\s*)?(worked on|helped|responsible for|assisted)/i.test(line));
    if (weak) {
      raw.push({ section: 'Experience', kind: 'edit', original: weak, proposed: weak.replace(/(worked on|helped with|helped|responsible for|assisted with|assisted)/i, 'Led'), rationale: 'Stronger ownership verb (demo suggestion).' });
    }
    const summary = lines.find((line) => line.split(' ').length >= 6 && line !== weak);
    const keyword = [...jdWords].find((word) => !input.resume.toLowerCase().includes(word));
    if (summary) {
      raw.push({ section: 'Summary', kind: 'edit', original: summary, proposed: `${summary.replace(/\.$/, '')}${keyword ? `, with a focus on ${keyword}` : ''}.`, rationale: 'Mirrors the job description vocabulary (demo suggestion).' });
    }
    const filler = lines.filter((line) => line !== weak && line !== summary).at(-1);
    if (filler && lines.length > 4) raw.push({ section: 'Resume', kind: 'removal', original: filler, proposed: '', rationale: 'Less relevant to this role (demo suggestion).' });
    if (lines[0]) raw.push({ section: 'Header', kind: 'addition', original: lines[0], proposed: 'Open to roles matching this job description', rationale: 'Signals intent (demo suggestion).' });
    return toResult(this.name, input, {
      summary: 'Demo analysis — set ANTHROPIC_API_KEY or OPENAI_API_KEY for real AI tailoring.',
      matchedKeywords: [...jdWords].filter((word) => input.resume.toLowerCase().includes(word)).slice(0, 10),
      missingKeywords: [...jdWords].filter((word) => !input.resume.toLowerCase().includes(word)).slice(0, 10),
      changes: raw,
    });
  }
}

export function getTailoringProvider(): TailoringProvider {
  const choice = (process.env.TAILORING_PROVIDER || '').toLowerCase();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (choice === 'anthropic') {
    if (!anthropicKey) throw new TailoringError('ANTHROPIC_API_KEY is not set.', 'AI tailoring is not configured yet (missing ANTHROPIC_API_KEY).');
    return new AnthropicTailoringProvider(anthropicKey);
  }
  if (choice === 'openai') {
    if (!openaiKey) throw new TailoringError('OPENAI_API_KEY is not set.', 'AI tailoring is not configured yet (missing OPENAI_API_KEY).');
    return serverOpenAI(openaiKey);
  }
  // "auto", "mock" or unset: a configured key always wins so a leftover TAILORING_PROVIDER=mock
  // cannot silently ship fake suggestions to real users.
  if (anthropicKey) return new AnthropicTailoringProvider(anthropicKey);
  if (openaiKey) return serverOpenAI(openaiKey);
  if (choice === 'mock' || process.env.NODE_ENV !== 'production') return new MockTailoringProvider();
  throw new TailoringError('No AI provider key configured.', 'AI tailoring is not configured yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the server environment.');
}

function serverOpenAI(apiKey: string) {
  return new OpenAICompatibleProvider({
    label: (process.env.OPENAI_BASE_URL || '').includes('openrouter') ? 'OpenRouter' : 'OpenAI',
    slug: (process.env.OPENAI_BASE_URL || '').includes('openrouter') ? 'openrouter' : 'openai',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey,
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    keySource: 'server',
  });
}
