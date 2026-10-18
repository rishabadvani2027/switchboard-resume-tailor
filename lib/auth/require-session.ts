import { NextResponse } from 'next/server';
import { getRequestSession, hasSupabase, isDemoMode } from './config';

export async function requireSession(request: Request) {
  const session = await getRequestSession(request);
  if (!session) {
    const error = isDemoMode
      ? 'Demo session unavailable'
      : hasSupabase ? 'Your session has expired. Please sign in again.' : 'Authentication is not configured on the server (SUPABASE_URL / SUPABASE_ANON_KEY).';
    return { session: null, response: NextResponse.json({ error }, { status: hasSupabase || isDemoMode ? 401 : 503 }) };
  }
  return { session, response: null };
}
