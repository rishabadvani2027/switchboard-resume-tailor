import { NextResponse } from 'next/server';
import { authConfig, hasSupabase, isDemoMode } from '../../../../lib/auth/config';
import { safeRedirectPath } from '../../../../lib/security/redirect';

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const email = form?.get('email');
  const password = form?.get('password');
  const next = safeRedirectPath(typeof form?.get('next') === 'string' ? form.get('next') as string : null);
  const redirectWithError = (error: string) =>
    NextResponse.redirect(new URL(`/signin?error=${error}`, request.url), 303);

  if (isDemoMode) return NextResponse.redirect(new URL(next, request.url), 303);
  if (!hasSupabase) return redirectWithError('auth-unavailable');
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return redirectWithError('credentials-required');
  }

  const tokenResponse = await fetch(`${authConfig.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: authConfig.supabaseAnonKey!, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  }).catch(() => null);
  if (!tokenResponse?.ok) {
    const error = tokenResponse?.status === 400 ? 'invalid-credentials' : 'auth-unavailable';
    return redirectWithError(error);
  }
  const tokens = await tokenResponse.json().catch(() => null) as {
    access_token?: string;
    refresh_token?: string;
  } | null;
  if (!tokens?.access_token || !tokens.refresh_token) return redirectWithError('auth-response-invalid');

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  const secure = new URL(request.url).protocol === 'https:';
  response.cookies.set('sb-access-token', tokens.access_token, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
  response.cookies.set('sb-refresh-token', tokens.refresh_token, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
  return response;
}
