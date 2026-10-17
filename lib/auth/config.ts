import type { NextRequest } from 'next/server';

export const authConfig = {
  mode: process.env.NEXT_PUBLIC_APP_MODE ?? 'production',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
};

export const isDemoMode = authConfig.mode === 'demo'
  && process.env.NODE_ENV !== 'production'
  && process.env.NEXT_PUBLIC_DEMO_LOCAL_ONLY === 'true';
export const hasSupabase = Boolean(authConfig.supabaseUrl && authConfig.supabaseAnonKey);

export type Session = { userId: string; email: string; verified: boolean };

export function getDemoSession(): Session {
  return { userId: 'demo-user', email: 'demo@example.com', verified: true };
}

export async function getRequestSession(request: Request | NextRequest): Promise<Session | null> {
  if (isDemoMode) return getDemoSession();
  if (!hasSupabase) return null;

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? request.headers.get('cookie')?.match(/(?:^|;\s*)sb-access-token=([^;]+)/)?.[1];
  if (!token) return null;

  const response = await fetch(`${authConfig.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: authConfig.supabaseAnonKey!, authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string; email?: string; email_confirmed_at?: string | null };
  if (!user.id || !user.email || !user.email_confirmed_at) return null;
  return { userId: user.id, email: user.email, verified: true };
}
