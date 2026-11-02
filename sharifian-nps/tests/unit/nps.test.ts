import { describe, expect, it } from 'vitest';
import { categorize, computeNps, isValidScore, npsFromCounts } from '../../src/core/nps.ts';

describe('categorize', () => {
  it.each([
    [0, 'detractor'], [6, 'detractor'],
    [7, 'passive'], [8, 'passive'],
    [9, 'promoter'], [10, 'promoter'],
  ] as const)('%i → %s', (score, category) => {
    expect(categorize(score)).toBe(category);
  });

  it.each([-1, 11, 6.5, Number.NaN, Infinity])('throws on %s', (score) => {
    expect(() => categorize(score)).toThrow(RangeError);
  });

  it('rejects non-numbers through isValidScore', () => {
    expect(isValidScore('7')).toBe(false);
    expect(isValidScore(null)).toBe(false);
    expect(isValidScore(7)).toBe(true);
  });
});

describe('computeNps', () => {
  it('n = 0 → null everywhere, never NaN', () => {
    const r = computeNps([]);
    expect(r.n).toBe(0);
    expect(r.nps).toBeNull();
    expect(r.moe).toBeNull();
    expect(r.mean).toBeNull();
    expect(r.pctPromoters).toBeNull();
  });

  it('all promoters → +100 with zero margin', () => {
    const r = computeNps([9, 10, 10, 9]);
    expect(r.nps).toBe(100);
    expect(r.moe).toBe(0);
    expect(r.mean).toBe(9.5);
  });

  it('all detractors → −100', () => {
    const r = computeNps([0, 3, 6]);
    expect(r.nps).toBe(-100);
    expect(r.moe).toBe(0);
  });

  it('balanced sample → 0 with hand-calculated margin', () => {
    // p = d = 1/3 → var = 2/3 − 0 = 0.6667 → MoE = 1.96 × √(0.6667/6) × 100 = 65.33
    const r = computeNps([10, 9, 8, 7, 6, 0]);
    expect(r.promoters).toBe(2);
    expect(r.passives).toBe(2);
    expect(r.detractors).toBe(2);
    expect(r.nps).toBeCloseTo(0, 10);
    expect(r.moe).toBeCloseTo(65.33, 2);
  });

  it('50/30/20 of 100 → NPS 30, MoE 15.31 (manual: var = 0.7 − 0.3² = 0.61)', () => {
    const r = npsFromCounts(50, 30, 20);
    expect(r.nps).toBeCloseTo(30, 10);
    expect(r.moe).toBeCloseTo(1.96 * Math.sqrt(0.61 / 100) * 100, 10);
    expect(r.moe).toBeCloseTo(15.31, 2);
    expect(r.pctPassives).toBeCloseTo(30, 10);
  });

  it('throws on invalid scores', () => {
    expect(() => computeNps([5, 11])).toThrow(RangeError);
  });
});
