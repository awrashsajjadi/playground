import { describe, expect, it } from 'vitest';
import { ipHash, randomId, safeEqual, signValue, unsignValue } from '../../src/core/crypto.ts';
import { RateLimiter } from '../../src/core/rate-limit.ts';

describe('RateLimiter (sliding window)', () => {
  it('allows `limit` hits per window, then blocks with a retry hint', () => {
    const rl = new RateLimiter(3, 60_000);
    expect(rl.hit('a', 0).ok).toBe(true);
    expect(rl.hit('a', 1_000).ok).toBe(true);
    expect(rl.hit('a', 2_000).ok).toBe(true);
    const blocked = rl.hit('a', 3_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(57);
    expect(rl.hit('b', 3_000).ok).toBe(true);
  });

  it('slides: old hits expire', () => {
    const rl = new RateLimiter(2, 10_000);
    rl.hit('a', 0);
    rl.hit('a', 5_000);
    expect(rl.hit('a', 9_999).ok).toBe(false);
    expect(rl.hit('a', 10_001).ok).toBe(true);
  });

  it('limit 0 disables it', () => {
    const rl = new RateLimiter(0, 1000);
    for (let i = 0; i < 100; i++) expect(rl.hit('a', i).ok).toBe(true);
  });
});

describe('signing helpers', () => {
  const secret = 'x'.repeat(32);

  it('round-trips and rejects tampering or a different purpose', () => {
    const signed = signValue(secret, 'form', 'abc.123');
    expect(unsignValue(secret, 'form', signed)).toBe('abc.123');
    expect(unsignValue(secret, 'csrf', signed)).toBeNull();
    expect(unsignValue(secret, 'form', signed.replace('abc', 'abd'))).toBeNull();
    expect(unsignValue('y'.repeat(32), 'form', signed)).toBeNull();
    expect(unsignValue(secret, 'form', 'no-dot')).toBeNull();
    expect(unsignValue(secret, 'form', 42)).toBeNull();
  });

  it('compares in constant time regardless of length', () => {
    expect(safeEqual('secret', 'secret')).toBe(true);
    expect(safeEqual('secret', 'secret!')).toBe(false);
  });

  it('hashes IPs without exposing them', () => {
    const h = ipHash(secret, '5.6.7.8');
    expect(h).toHaveLength(16);
    expect(h).not.toContain('5.6.7.8');
    expect(ipHash(secret, '5.6.7.8')).toBe(h);
    expect(ipHash(secret, '5.6.7.9')).not.toBe(h);
  });

  it('random ids are unique', () => {
    expect(new Set(Array.from({ length: 100 }, () => randomId())).size).toBe(100);
  });
});
