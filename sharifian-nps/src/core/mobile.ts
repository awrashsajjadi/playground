// Iranian mobile normalization. Shared by server and browser bundles (one tested function).
import { toAsciiDigits } from './fa.ts';

// Separators people type or paste: spaces, NBSP, invisible bidi marks, (), dots, dashes, underscores, slashes.
const SEPARATORS = /[\s\u00A0\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF().\-\u2010-\u2015_/]/g;

export const MOBILE_PATTERN = /^09\d{9}$/;

/**
 * Accepts Persian/Arabic digits, separators and the prefixes +98, 0098, 98 or a bare 9xxxxxxxxx.
 * Returns the canonical 09xxxxxxxxx form, or null when the input is not an Iranian mobile number.
 */
export function normalizeMobile(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  let s = toAsciiDigits(input).replace(SEPARATORS, '');
  if (!/^\+?\d+$/.test(s)) return null;

  if (s.startsWith('+')) {
    if (!s.startsWith('+98')) return null;
    s = s.slice(3);
  } else if (s.startsWith('0098')) {
    s = s.slice(4);
  } else if (s.startsWith('98') && s.length === 12) {
    s = s.slice(2);
  }
  if (s.length === 10 && s.startsWith('9')) s = `0${s}`;

  return MOBILE_PATTERN.test(s) ? s : null;
}
