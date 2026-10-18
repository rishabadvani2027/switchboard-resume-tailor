import { NextResponse } from 'next/server';
import { authConfig, hasSupabase, isDemoMode } from '../../../../lib/auth/config';
import { createOAuthState, createPkceChallenge, createPkceVerifier, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from '../../../../lib/auth/oauth';
import { safeRedirectPath } from '../../../../lib/security/redirect';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeRedirectPath(url.searchParams.get('next'));
  if (isDemoMode) return NextResponse.redirect(new URL(next, url.origin));
  if (!hasSupabase) return NextResponse.redirect(new URL('/signin?error=auth-unavailable', url.origin));

  const state = createOAuthState();
  const verifier = createPkceVerifier();
  const callback = new URL('/auth/callback', url.origin);
  callback.searchParams.set('next', next);
  callback.searchParams.set('state', state);

  const authorize = new URL(`${authConfig.supabaseUrl}/auth/v1/authorize`);
  authorize.searchParams.set('provider', 'google');
  authorize.searchParams.set('redirect_to', callback.toString());
  authorize.searchParams.set('code_challenge', createPkceChallenge(verifier));
  authorize.searchParams.set('code_challenge_method', 's256');

  const response = NextResponse.redirect(authorize);
  const secure = url.protocol === 'https:';
  response.cookies.set(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 600 });
  response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 600 });
  return response;
}
