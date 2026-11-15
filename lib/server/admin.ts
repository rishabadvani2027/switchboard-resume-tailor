import { authConfig } from '../auth/config';

/**
 * Server-only Supabase access with the service role, used by the payment webhook (which has no
 * user session) to write subscription state. Never import this into client components.
 *
 * Accepts either a new secret key (sb_secret_…) or the legacy service_role JWT.
 */
const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)?.trim();

export const hasServiceRole = () => Boolean(authConfig.supabaseUrl && serviceKey());

export async function adminRest<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const key = serviceKey();
  if (!authConfig.supabaseUrl || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  const { prefer, headers, ...rest } = init;
  const response = await fetch(`${authConfig.supabaseUrl}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: key,
      // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys don't.
      ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}),
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
      ...headers,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase admin ${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
