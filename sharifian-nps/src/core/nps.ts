export type Category = 'promoter' | 'passive' | 'detractor';

export const CATEGORIES: readonly Category[] = ['promoter', 'passive', 'detractor'];

export function isValidScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10;
}

/** 9–10 promoter · 7–8 passive · 0–6 detractor. Throws on anything that is not an integer 0..10. */
export function categorize(score: number): Category {
  if (!isValidScore(score)) throw new RangeError(`Invalid NPS score: ${String(score)}`);
  if (score >= 9) return 'promoter';
  if (score >= 7) return 'passive';
  return 'detractor';
}

export interface NpsSummary {
  n: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** Percentages 0..100; null when n = 0. */
  pctPromoters: number | null;
  pctPassives: number | null;
  pctDetractors: number | null;
  /** −100..+100; null when n = 0 (never NaN). */
  nps: number | null;
  /** 95% margin of error in NPS points: 1.96 × √(((p+d) − (p−d)²) / n) × 100. */
  moe: number | null;
  mean: number | null;
}

export function npsFromCounts(promoters: number, passives: number, detractors: number, scoreSum?: number): NpsSummary {
  const n = promoters + passives + detractors;
  if (n === 0) {
    return {
      n, promoters, passives, detractors,
      pctPromoters: null, pctPassives: null, pctDetractors: null,
      nps: null, moe: null, mean: null,
    };
  }
  const p = promoters / n;
  const d = detractors / n;
  const variance = Math.max(0, p + d - (p - d) ** 2);
  return {
    n, promoters, passives, detractors,
    pctPromoters: p * 100,
    pctPassives: (passives / n) * 100,
    pctDetractors: d * 100,
    nps: (p - d) * 100,
    moe: 1.96 * Math.sqrt(variance / n) * 100,
    mean: scoreSum === undefined ? null : scoreSum / n,
  };
}

export function computeNps(scores: Iterable<number>): NpsSummary {
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  let sum = 0;
  for (const score of scores) {
    const category = categorize(score);
    if (category === 'promoter') promoters++;
    else if (category === 'passive') passives++;
    else detractors++;
    sum += score;
  }
  return npsFromCounts(promoters, passives, detractors, sum);
}
