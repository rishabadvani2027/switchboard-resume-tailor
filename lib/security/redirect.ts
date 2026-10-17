export function safeRedirectPath(value: string | null | undefined, fallback = '/intake') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const url = new URL(value, 'http://local.invalid');
    return url.origin === 'http://local.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
