import type { NextRequest } from 'next/server';

export const authConfig = {
  mode: process.env.NEXT_PUBLIC_APP_MODE ?? 'production',
  supabaseUrl: process.env.SUPABASE_URL?.replace(/\/+$/, ''),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
};

/**
 * Demo mode skips authentication and keeps data in server memory. It is only allowed for
 * local development so a misconfigured deployment can never expose an unauthenticated app.
 */
export const isDemoMode = authConfig.mode === 'demo'
  && process.env.NODE_ENV !== 'production'
  && process.env.NEXT_PUBLIC_DEMO_LOCAL_ONLY === 'true';
export const hasSupabase = Boolean(authConfig.supabaseUrl && authConfig.supabaseAnonKey);

export const ACCESS_COOKIE = 'sb-access-token';
export const REFRESH_COOKIE = 'sb-refresh-token';

export type Session = { userId: string; email: string; verified: boolean; accessToken: string | null };

export function getDemoSession(): Session {
  return { userId: 'demo-user', email: 'demo@example.com', verified: true, accessToken: null };
}

export function readCookie(cookieHeader: string | null, name: string) {
  const match = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getAccessToken(request: Request | NextRequest) {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || readCookie(request.headers.get('cookie'), ACCESS_COOKIE);
}

export type SupabaseUser = { id?: string; email?: string; email_confirmed_at?: string | null };

export async function fetchSupabaseUser(token: string): Promise<SupabaseUser | null> {
  if (!hasSupabase) return null;
  const response = await fetch(`${authConfig.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: authConfig.supabaseAnonKey!, authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null) as Promise<SupabaseUser | null>;
}

export type SupabaseTokens = { access_token: string; refresh_token: string; expires_in?: number };

export async function refreshSupabaseSession(refreshToken: string): Promise<SupabaseTokens | null> {
  if (!hasSupabase) return null;
  const response = await fetch(`${authConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: authConfig.supabaseAnonKey!, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) return null;
  const tokens = await response.json().catch(() => null) as Partial<SupabaseTokens> | null;
  return tokens?.access_token && tokens.refresh_token ? tokens as SupabaseTokens : null;
}

export async function getRequestSession(request: Request | NextRequest): Promise<Session | null> {
  if (isDemoMode) return getDemoSession();
  if (!hasSupabase) return null;
  const token = getAccessToken(request);
  if (!token) return null;
  const user = await fetchSupabaseUser(token);
  if (!user?.id || !user.email || !user.email_confirmed_at) return null;
  return { userId: user.id, email: user.email, verified: true, accessToken: token };
}

export const sessionCookieOptions = (secure: boolean, maxAge: number) => ({
  httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge,
});
export const ACCESS_MAX_AGE = 60 * 60 * 24 * 7;
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;
