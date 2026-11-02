// HMAC helpers (server only). Every signed value carries a purpose prefix so tokens can't be swapped.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function hmac(secret: string, data: string, length = 22): string {
  return createHmac('sha256', secret).update(data).digest('base64url').slice(0, length);
}

/** Constant-time comparison that also hides the length (both sides are hashed first). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

export function signValue(secret: string, purpose: string, value: string): string {
  return `${value}.${hmac(secret, `${purpose}:${value}`)}`;
}

export function unsignValue(secret: string, purpose: string, signed: unknown): string | null {
  if (typeof signed !== 'string' || signed.length === 0 || signed.length > 4096) return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  return safeEqual(signed.slice(dot + 1), hmac(secret, `${purpose}:${value}`)) ? value : null;
}

/** Salted, truncated hash: lets us rate-limit and spot abuse without ever storing a raw IP. */
export function ipHash(secret: string, ip: string): string {
  return hmac(secret, `ip:${ip}`, 16);
}
