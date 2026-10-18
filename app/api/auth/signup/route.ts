import { NextResponse } from 'next/server';
import { authConfig, hasSupabase, isDemoMode } from '../../../../lib/auth/config';
import { safeRedirectPath } from '../../../../lib/security/redirect';

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const email = form?.get('email');
  const password = form?.get('password');
  const confirmPassword = form?.get('confirmPassword');
  const next = safeRedirectPath(typeof form?.get('next') === 'string' ? form.get('next') as string : null);
  const redirect = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);

  if (isDemoMode) return redirect(`/signup?message=verification-sent&next=${encodeURIComponent(next)}`);
  if (!hasSupabase) return redirect('/signup?error=auth-unavailable');
  if (typeof email !== 'string' || typeof password !== 'string' || typeof confirmPassword !== 'string'
    || !email.trim() || password.length < 6) {
    return redirect('/signup?error=credentials-required');
  }
  if (password !== confirmPassword) return redirect('/signup?error=password-mismatch');

  const emailRedirectTo = `${new URL(request.url).origin}/signin?message=email-verified&next=${encodeURIComponent(next)}`;
  const response = await fetch(`${authConfig.supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(emailRedirectTo)}`, {
    method: 'POST',
    headers: { apikey: authConfig.supabaseAnonKey!, 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
    cache: 'no-store',
  }).catch(() => null);

  if (!response?.ok) {
    const body = await response?.json().catch(() => null) as { error_code?: string; code?: string } | null;
    const code = body?.error_code ?? body?.code;
    if (code === 'user_already_exists' || code === 'email_exists') return redirect('/signup?error=email-in-use');
    if (code === 'weak_password') return redirect('/signup?error=weak-password');
    if (response?.status === 429 || code === 'over_email_send_rate_limit') return redirect('/signup?error=rate-limited');
    console.error('[auth] sign-up failed', response?.status, body);
    return redirect('/signup?error=signup-failed');
  }
  return redirect(`/signup?message=verification-sent&next=${encodeURIComponent(next)}`);
}
