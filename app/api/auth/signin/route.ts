import { NextResponse } from 'next/server';
import {
  ACCESS_COOKIE, ACCESS_MAX_AGE, authConfig, hasSupabase, isDemoMode, REFRESH_COOKIE, REFRESH_MAX_AGE, sessionCookieOptions,
} from '../../../../lib/auth/config';
import { safeRedirectPath } from '../../../../lib/security/redirect';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const email = form?.get('email');
  const password = form?.get('password');
  const nextValue = form?.get('next');
  const next = safeRedirectPath(typeof nextValue === 'string' ? nextValue : null);
  const redirectWithError = (error: string) =>
    NextResponse.redirect(new URL(`/signin?error=${error}&next=${encodeURIComponent(next)}`, request.url), 303);

  if (isDemoMode) return NextResponse.redirect(new URL(next, request.url), 303);
  if (!hasSupabase) return redirectWithError('auth-unavailable');
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return redirectWithError('credentials-required');
  }

  const tokenResponse = await fetch(`${authConfig.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: authConfig.supabaseAnonKey!, 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
    cache: 'no-store',
  }).catch(() => null);
  if (!tokenResponse?.ok) {
    const body = await tokenResponse?.json().catch(() => null) as { error_code?: string; code?: string; msg?: string; error_description?: string } | null;
    const code = body?.error_code ?? body?.code ?? '';
    if (code === 'email_not_confirmed' || /not confirmed/i.test(body?.msg ?? body?.error_description ?? '')) return redirectWithError('verify-email');
    if (tokenResponse?.status === 400 || tokenResponse?.status === 401) return redirectWithError('invalid-credentials');
    if (tokenResponse?.status === 429) return redirectWithError('rate-limited');
    return redirectWithError('auth-unavailable');
  }
  const tokens = await tokenResponse.json().catch(() => null) as { access_token?: string; refresh_token?: string } | null;
  if (!tokens?.access_token || !tokens.refresh_token) return redirectWithError('auth-response-invalid');

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  const secure = new URL(request.url).protocol === 'https:';
  response.cookies.set(ACCESS_COOKIE, tokens.access_token, sessionCookieOptions(secure, ACCESS_MAX_AGE));
  response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, sessionCookieOptions(secure, REFRESH_MAX_AGE));
  return response;
}
