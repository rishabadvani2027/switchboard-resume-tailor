import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/auth/require-session';
import { BYOK_PROVIDERS, parseByok, redactSecrets, TailoringError } from '../../../../lib/tailoring/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Checks a user's own AI key with a tiny request. The key is not stored. */
export async function POST(request: Request) {
  const { response } = await requireSession(request);
  if (response) return response;
  const body = await request.json().catch(() => null) as { byok?: unknown } | null;
  try {
    const config = parseByok(body?.byok);
    if (!config) return NextResponse.json({ error: 'Choose a provider and paste your API key.' }, { status: 400 });
    const meta = BYOK_PROVIDERS[config.provider];
    const model = config.model || meta.defaultModel;
    const init: RequestInit = config.provider === 'anthropic'
      ? {
        method: 'POST',
        headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK' }] }),
      }
      : {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK' }] }),
      };
    const url = config.provider === 'anthropic' ? `${meta.baseUrl}/messages` : `${meta.baseUrl}/chat/completions`;
    const result = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!result) return NextResponse.json({ ok: false, error: `Could not reach ${meta.label}.` }, { status: 502 });
    if (result.ok) return NextResponse.json({ ok: true, model });
    const detail = redactSecrets((await result.text().catch(() => '')).slice(0, 300));
    const message = result.status === 401 || result.status === 403
      ? 'That API key was rejected.'
      : result.status === 404 ? `The model "${model}" was not found for this provider.`
        : result.status === 429 || result.status === 402 ? 'The key works, but the account is rate-limited or out of credit.'
          : `${meta.label} returned an error (${result.status}).`;
    console.warn('[ai-test]', config.provider, result.status, detail);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  } catch (error) {
    if (error instanceof TailoringError) return NextResponse.json({ ok: false, error: error.userMessage }, { status: 400 });
    return NextResponse.json({ ok: false, error: 'The key could not be tested.' }, { status: 500 });
  }
}
