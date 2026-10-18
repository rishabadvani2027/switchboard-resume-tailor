import { createHash, randomBytes } from 'node:crypto';
import { readCookie } from './config';

export const OAUTH_STATE_COOKIE = 'sb-oauth-state';
export const OAUTH_VERIFIER_COOKIE = 'sb-code-verifier';

export function createOAuthState() {
  return randomBytes(32).toString('base64url');
}

export function createPkceVerifier() {
  return randomBytes(32).toString('base64url');
}

export function createPkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function getCookie(request: Request, name: string) {
  return readCookie(request.headers.get('cookie'), name);
}

/**
 * Supabase does not echo a custom `state` parameter back, so the app carries its own state in
 * the `redirect_to` URL and compares it with the cookie set when the flow started. The PKCE
 * verifier cookie additionally binds the authorization code to this browser.
 */
export function validateOAuthCallback(request: Request, returnedState: string | null) {
  const expectedState = getCookie(request, OAUTH_STATE_COOKIE);
  if (!returnedState || !expectedState) return 'oauth-state-missing' as const;
  if (returnedState !== expectedState) return 'oauth-state-mismatch' as const;
  if (!getCookie(request, OAUTH_VERIFIER_COOKIE)) return 'oauth-verifier-missing' as const;
  return null;
}
