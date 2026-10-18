import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, authConfig, getAccessToken, hasSupabase, REFRESH_COOKIE } from '../../../../lib/auth/config';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const token = getAccessToken(request);
  if (hasSupabase && token) {
    await fetch(`${authConfig.supabaseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: authConfig.supabaseAnonKey!, authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => null);
  }
  const response = NextResponse.redirect(new URL('/signin?message=signed-out', request.url), 303);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
