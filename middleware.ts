import { NextResponse, type NextRequest } from 'next/server';
import { authConfig, isDemoMode } from './lib/auth/config';

export async function middleware(request: NextRequest) {
  if (isDemoMode) return NextResponse.next();
  if (!authConfig.supabaseUrl || !authConfig.supabaseAnonKey) {
    return NextResponse.redirect(new URL('/signin?error=auth-unavailable', request.url));
  }
  const token = request.cookies.get('sb-access-token')?.value;
  if (!token) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  const response = await fetch(`${authConfig.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: authConfig.supabaseAnonKey, authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  const user = await response.json() as { email_confirmed_at?: string | null };
  if (!user.email_confirmed_at) return NextResponse.redirect(new URL('/signin?error=verify-email', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/intake/:path*', '/review/:path*', '/export/:path*', '/billing/:path*', '/api/analyze', '/api/changes', '/api/exports', '/api/documents', '/api/billing'] };
