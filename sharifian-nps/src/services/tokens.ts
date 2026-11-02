// Signed tokens: form token (anti-spam timing + funnel session) and 24h test links.
import { randomId, signValue, unsignValue } from '../core/crypto.ts';

export interface FormToken {
  sid: string;
  issuedAt: number;
  test: boolean;
}

/** tk = sid.issuedAt(base36).flag.signature — issued when the form is rendered. */
export function issueFormToken(secret: string, nowMs: number, test: boolean): string {
  return signValue(secret, 'form', `${randomId(12)}.${nowMs.toString(36)}.${test ? 't' : 'l'}`);
}

export function readFormToken(secret: string, token: unknown): FormToken | null {
  const value = unsignValue(secret, 'form', token);
  if (!value) return null;
  const [sid, ts, flag] = value.split('.');
  const issuedAt = parseInt(ts ?? '', 36);
  if (!sid || !Number.isFinite(issuedAt) || (flag !== 't' && flag !== 'l')) return null;
  return { sid, issuedAt, test: flag === 't' };
}

export const TEST_LINK_TTL_MS = 24 * 3600_000;

/** ?t= value for "test from every channel" links (form works before opening, saved as kind=test). */
export function issueTestLinkToken(secret: string, nowMs: number): string {
  return signValue(secret, 'test', (nowMs + TEST_LINK_TTL_MS).toString(36));
}

export function isValidTestLink(secret: string, token: unknown, nowMs: number): boolean {
  const value = unsignValue(secret, 'test', token);
  if (!value) return false;
  const expires = parseInt(value, 36);
  return Number.isFinite(expires) && expires > nowMs;
}
