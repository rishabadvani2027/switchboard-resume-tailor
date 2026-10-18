import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE, ACCESS_MAX_AGE, fetchSupabaseUser, hasSupabase, isDemoMode, REFRESH_COOKIE, REFRESH_MAX_AGE,
  refreshSupabaseSession, sessionCookieOptions,
} from './lib/auth/config';

function deny(request: NextRequest, error?: string) {
  const isApi = request.nextUrl.pathname.startsWith('/api/');
  if (isApi) {
    return NextResponse.json(
      { error: error === 'verify-email' ? 'Verify your email address first.' : error === 'auth-unavailable' ? 'Authentication is not configured on the server.' : 'Your session has expired. Please sign in again.' },
      { status: error === 'auth-unavailable' ? 503 : 401 },
    );
  }
  const target = new URL('/signin', request.url);
  if (error) target.searchParams.set('error', error);
  target.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(target);
  if (!error || error === 'session-expired') {
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
  }
  return response;
}

export async function middleware(request: NextRequest) {
  if (isDemoMode) return NextResponse.next();
  if (!hasSupabase) return deny(request, 'auth-unavailable');

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!accessToken && !refreshToken) return deny(request);

  let user = accessToken ? await fetchSupabaseUser(accessToken) : null;
  let refreshed: Awaited<ReturnType<typeof refreshSupabaseSession>> = null;
  if (!user?.id && refreshToken) {
    // Access tokens expire after an hour; silently renew them with the refresh token.
    refreshed = await refreshSupabaseSession(refreshToken);
    if (refreshed) user = await fetchSupabaseUser(refreshed.access_token);
  }
  if (!user?.id) return deny(request, accessToken ? 'session-expired' : undefined);
  if (!user.email_confirmed_at) return deny(request, 'verify-email');

  if (!refreshed) return NextResponse.next();

  // Forward the renewed token to the route handler in this same request, and store it.
  request.cookies.set(ACCESS_COOKIE, refreshed.access_token);
  request.cookies.set(REFRESH_COOKIE, refreshed.refresh_token);
  const headers = new Headers(request.headers);
  headers.set('cookie', request.cookies.toString());
  const response = NextResponse.next({ request: { headers } });
  const secure = request.nextUrl.protocol === 'https:';
  response.cookies.set(ACCESS_COOKIE, refreshed.access_token, sessionCookieOptions(secure, ACCESS_MAX_AGE));
  response.cookies.set(REFRESH_COOKIE, refreshed.refresh_token, sessionCookieOptions(secure, REFRESH_MAX_AGE));
  return response;
}

export const config = {
  matcher: [
    '/intake/:path*', '/settings/:path*', '/review/:path*', '/export/:path*', '/billing/:path*',
    '/api/analyze/:path*', '/api/ai/:path*', '/api/changes/:path*', '/api/exports/:path*', '/api/documents/:path*', '/api/billing/:path*',
  ],
};
