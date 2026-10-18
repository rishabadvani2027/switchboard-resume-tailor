import { NextResponse } from 'next/server';
import {
  ACCESS_COOKIE, ACCESS_MAX_AGE, authConfig, hasSupabase, isDemoMode, REFRESH_COOKIE, REFRESH_MAX_AGE, sessionCookieOptions,
} from '../../../lib/auth/config';
import { getCookie, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, validateOAuthCallback } from '../../../lib/auth/oauth';
import { safeRedirectPath } from '../../../lib/security/redirect';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeRedirectPath(url.searchParams.get('next'));
  if (isDemoMode) return NextResponse.redirect(new URL(next, url.origin));
  if (!hasSupabase) return NextResponse.redirect(new URL('/signin?error=auth-unavailable', url.origin));

  const fail = (error: string) => {
    const response = NextResponse.redirect(new URL(`/signin?error=${error}`, url.origin));
    response.cookies.delete(OAUTH_VERIFIER_COOKIE);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  };

  if (url.searchParams.get('error')) return fail('oauth-denied');
  const code = url.searchParams.get('code');
  if (!code) return fail('oauth-code-missing');

  const callbackError = validateOAuthCallback(request, url.searchParams.get('state'));
  if (callbackError) return fail(callbackError);
  const verifier = getCookie(request, OAUTH_VERIFIER_COOKIE)!;

  const exchange = await fetch(`${authConfig.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: { apikey: authConfig.supabaseAnonKey!, 'content-type': 'application/json' },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    cache: 'no-store',
  }).catch(() => null);
  if (!exchange?.ok) {
    console.error('[auth] PKCE exchange failed', exchange?.status, await exchange?.text().catch(() => ''));
    return fail('oauth-exchange-failed');
  }

  const tokens = await exchange.json().catch(() => null) as { access_token?: string; refresh_token?: string } | null;
  if (!tokens?.access_token || !tokens.refresh_token) return fail('oauth-exchange-invalid');

  const response = NextResponse.redirect(new URL(next, url.origin));
  const secure = url.protocol === 'https:';
  response.cookies.set(ACCESS_COOKIE, tokens.access_token, sessionCookieOptions(secure, ACCESS_MAX_AGE));
  response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, sessionCookieOptions(secure, REFRESH_MAX_AGE));
  response.cookies.delete(OAUTH_VERIFIER_COOKIE);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
