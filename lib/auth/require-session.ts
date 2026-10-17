import { NextResponse } from 'next/server';
import { getRequestSession, isDemoMode } from './config';

export async function requireSession(request: Request) {
  const session = await getRequestSession(request);
  if (!session) {
    return { session: null, response: NextResponse.json(
      { error: isDemoMode ? 'Demo session unavailable' : 'Authentication required' },
      { status: 401 },
    ) };
  }
  return { session, response: null };
}
