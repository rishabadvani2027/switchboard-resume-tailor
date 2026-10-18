'use client';
import type { ByokProviderId } from './tailoring/byok-providers';

export type ByokSettings = { provider: ByokProviderId; apiKey: string; model?: string };

const STORAGE_KEY = 'switchboard.byok.v1';

/** The user's own AI key lives only in this browser. It is sent with each analysis and never stored on the server. */
export function loadByok(): ByokSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ByokSettings>;
    return parsed.provider && parsed.apiKey ? (parsed as ByokSettings) : null;
  } catch {
    return null;
  }
}

export function saveByok(settings: ByokSettings | null) {
  try {
    if (settings) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable */ }
}

export const maskKey = (key: string) => (key.length <= 8 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`);
