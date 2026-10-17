import { createHash, randomBytes } from 'node:crypto';

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
  return request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? null;
}

export function validateOAuthCallback(request: Request, returnedState: string | null) {
  const expectedState = getCookie(request, 'sb-oauth-state');
  if (!returnedState || !expectedState) return 'oauth-state-missing' as const;
  if (returnedState !== expectedState) return 'oauth-state-mismatch' as const;
  if (!getCookie(request, 'sb-code-verifier')) return 'oauth-verifier-missing' as const;
  return null;
}
