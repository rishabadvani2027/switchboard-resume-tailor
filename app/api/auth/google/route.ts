import { NextResponse } from 'next/server';
import { authConfig, hasSupabase, isDemoMode } from '../../../../lib/auth/config';
import { createOAuthState, createPkceChallenge, createPkceVerifier } from '../../../../lib/auth/oauth';
import { safeRedirectPath } from '../../../../lib/security/redirect';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeRedirectPath(url.searchParams.get('next'));
  if (isDemoMode) return NextResponse.redirect(new URL(next, url.origin));
  if (!hasSupabase) return NextResponse.redirect(new URL('/signin?error=auth-unavailable', url.origin));

  const state = createOAuthState();
  const verifier = createPkceVerifier();
  const authorize = new URL(`${authConfig.supabaseUrl}/auth/v1/authorize`);
  authorize.searchParams.set('provider', 'google');
  authorize.searchParams.set('redirect_to', `${url.origin}/auth/callback?next=${encodeURIComponent(next)}`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', createPkceChallenge(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');

  const response = NextResponse.redirect(authorize);
  const secure = url.protocol === 'https:';
  response.cookies.set('sb-oauth-state', state, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 600 });
  response.cookies.set('sb-code-verifier', verifier, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 600 });
  return response;
}
