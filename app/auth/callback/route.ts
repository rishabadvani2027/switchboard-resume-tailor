import { NextResponse } from 'next/server';
import { authConfig, hasSupabase, isDemoMode } from '../../../lib/auth/config';
import { getCookie, validateOAuthCallback } from '../../../lib/auth/oauth';
import { safeRedirectPath } from '../../../lib/security/redirect';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeRedirectPath(url.searchParams.get('next'));
  if (isDemoMode) return NextResponse.redirect(new URL(next, url.origin));
  if (!hasSupabase) return NextResponse.redirect(new URL('/signin?error=auth-unavailable', url.origin));

  const code = url.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/signin?error=oauth-code-missing', url.origin));

  const returnedState = url.searchParams.get('state');
  const callbackError = validateOAuthCallback(request, returnedState);
  if (callbackError) return NextResponse.redirect(new URL(`/signin?error=${callbackError}`, url.origin));
  const verifier = getCookie(request, 'sb-code-verifier');
  if (!verifier) return NextResponse.redirect(new URL('/signin?error=oauth-verifier-missing', url.origin));
  const exchange = await fetch(`${authConfig.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: {
      apikey: authConfig.supabaseAnonKey!,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ code, code_verifier: verifier }),
    cache: 'no-store',
  }).catch(() => null);
  if (!exchange?.ok) return NextResponse.redirect(new URL('/signin?error=oauth-exchange-failed', url.origin));

  const tokens = await exchange.json().catch(() => null) as {
    access_token?: string;
    refresh_token?: string;
  } | null;
  if (!tokens?.access_token || !tokens.refresh_token) {
    return NextResponse.redirect(new URL('/signin?error=oauth-exchange-invalid', url.origin));
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  const secure = url.protocol === 'https:';
  response.cookies.set('sb-access-token', tokens.access_token, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
  response.cookies.set('sb-refresh-token', tokens.refresh_token, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
  response.cookies.delete('sb-code-verifier');
  response.cookies.delete('sb-oauth-state');
  return response;
}
