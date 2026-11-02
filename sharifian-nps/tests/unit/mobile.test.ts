import { describe, expect, it } from 'vitest';
import { normalizeMobile } from '../../src/core/mobile.ts';

describe('normalizeMobile', () => {
  const valid: [string, string][] = [
    ['09121234567', 'canonical form'],
    ['۰۹۱۲۱۲۳۴۵۶۷', 'Persian digits'],
    ['٠٩١٢١٢٣٤٥٦٧', 'Arabic-Indic digits'],
    ['0912 123 4567', 'spaces'],
    ['0912-123-4567', 'dashes'],
    ['(0912) 123.45.67', 'brackets and dots'],
    ['+989121234567', '+98'],
    ['+98 912 123 4567', '+98 with spaces'],
    ['+۹۸ ۹۱۲ ۱۲۳ ۴۵۶۷', '+98 with Persian digits'],
    ['00989121234567', '0098'],
    ['0098 912 123 4567', '0098 with spaces'],
    ['989121234567', '98 without plus'],
    ['9121234567', 'bare 9xxxxxxxxx'],
    ['+98 0912 123 4567', '+98 followed by a leading zero'],
    ['  09121234567  ', 'surrounding whitespace'],
    ['\u200E0912\u200C1234567\u200F', 'invisible bidi marks and ZWNJ'],
    ['۰۹۱۲–۱۲۳–۴۵۶۷', 'en dashes'],
  ];
  it.each(valid)('accepts %s (%s)', (input) => {
    expect(normalizeMobile(input)).toBe('09121234567');
  });

  const invalid: [unknown, string][] = [
    ['', 'empty'],
    ['0912123456', 'too short'],
    ['091212345678', 'too long'],
    ['02112345678', 'Tehran landline'],
    ['+1 555 123 4567', 'foreign number'],
    ['abc', 'letters'],
    ['0912abc4567', 'letters inside'],
    ['0912+1234567', 'plus in the middle'],
    ['9809121234567', '98 + 0 + nine digits (not supported)'],
    [9121234567, 'number type'],
    [null, 'null'],
    [undefined, 'undefined'],
    ['0'.repeat(50), 'very long input'],
  ];
  it.each(invalid)('rejects %s (%s)', (input) => {
    expect(normalizeMobile(input)).toBeNull();
  });
});
