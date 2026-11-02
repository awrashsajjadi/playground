import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS, campaignDays, daily, driverMatrix, effectiveRep, filterCustomers, filterEvents, filterRows,
  followupList, funnel, groupNps, histogram, median, selectQuotes, strengthsAndPains, summarize, themeBreakdown,
  type Row,
} from '../../src/core/analytics.ts';
import { categorize } from '../../src/core/nps.ts';

let nextId = 1;
function row(score: number, extra: Partial<Row> = {}): Row {
  const id = nextId++;
  return {
    id, mobile: `0912000${String(id).padStart(4, '0')}`, score, category: categorize(score), drivers: [], comment: null,
    contactOk: false, src: 'sms', rep: null, durationMs: 40_000, createdAt: '2026-11-08T06:00:00.000Z', day: '2026-11-08',
    followupStatus: score <= 6 ? 'todo' : 'none', followupNote: null, followupBy: null, followupAt: null, themes: [],
    featured: false, customerId: null, name: null, company: null, city: null, province: null, customerType: null,
    tier: null, salesRep: null, ...extra,
  };
}

const drivers = [
  { id: 'quality', label: 'کیفیت' },
  { id: 'price', label: 'قیمت' },
  { id: 'delivery', label: 'ارسال' },
];

describe('summaries', () => {
  it('summarize matches the hand-calculated NPS and MoE (5 P, 3 Pa, 2 D)', () => {
    const rows = [10, 10, 9, 9, 9, 8, 7, 7, 3, 0].map((s) => row(s));
    const s = summarize(rows);
    // p = .5, d = .2 → NPS 30; var = .7 − .09 = .61; MoE = 1.96·√(.61/10)·100 = 48.41
    expect(s.nps).toBeCloseTo(30, 10);
    expect(s.moe).toBeCloseTo(48.41, 2);
    expect(s.mean).toBeCloseTo(7.2, 10);
  });

  it('histogram counts every score 0..10', () => {
    expect(histogram([0, 10, 10, 5].map((s) => row(s)))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2]);
  });

  it('daily: counts per day and cumulative NPS (null before the first response)', () => {
    const rows = [
      row(10, { day: '2026-11-09' }),
      row(0, { day: '2026-11-09' }),
      row(9, { day: '2026-11-10' }),
    ];
    expect(daily(rows, ['2026-11-08', '2026-11-09', '2026-11-10'])).toEqual([
      { day: '2026-11-08', count: 0, cumulativeNps: null },
      { day: '2026-11-09', count: 2, cumulativeNps: 0 },
      { day: '2026-11-10', count: 1, cumulativeNps: (2 / 3 - 1 / 3) * 100 },
    ]);
  });

  it('median handles empty, odd and even inputs', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('filters', () => {
  const a = row(10, { day: '2026-11-08', src: 'sms', city: 'تهران', customerType: 'عطاری', tier: 'A', salesRep: 'r01', customerId: 1 });
  const b = row(3, { day: '2026-11-10', src: 'wa', rep: 'r02' });
  const c = row(8, { day: '2026-11-12', src: 'sms', city: 'مشهد', tier: 'C', salesRep: 'r02', rep: 'r09', customerId: 2 });

  it('by date range, channel, segment, rep and matched-only', () => {
    expect(filterRows([a, b, c], { ...EMPTY_FILTERS, from: '2026-11-09', to: '2026-11-11' })).toEqual([b]);
    expect(filterRows([a, b, c], { ...EMPTY_FILTERS, src: 'sms' })).toEqual([a, c]);
    expect(filterRows([a, b, c], { ...EMPTY_FILTERS, city: 'تهران' })).toEqual([a]);
    expect(filterRows([a, b, c], { ...EMPTY_FILTERS, tier: 'C' })).toEqual([c]);
    expect(filterRows([a, b, c], { ...EMPTY_FILTERS, rep: 'r02' })).toEqual([b, c]); // c: assigned rep wins over link rep
    expect(filterRows([a, b, c], { ...EMPTY_FILTERS, matchedOnly: true })).toEqual([a, c]);
  });

  it('effective rep = assigned sales rep, else the link rep', () => {
    expect(effectiveRep(c)).toBe('r02');
    expect(effectiveRep(b)).toBe('r02');
    expect(effectiveRep(row(9))).toBeNull();
  });

  it('customers ignore date/channel filters; events ignore customer filters', () => {
    const customers = [{ city: 'تهران', customerType: 'عطاری', tier: 'A', salesRep: 'r01' }, { city: 'مشهد', customerType: null, tier: 'C', salesRep: 'r02' }];
    expect(filterCustomers(customers, { ...EMPTY_FILTERS, city: 'تهران', src: 'wa', from: '2026-11-20' })).toHaveLength(1);
    const events = [{ sessionId: 's1', type: 'view', src: 'sms', day: '2026-11-08' }, { sessionId: 's2', type: 'view', src: 'wa', day: '2026-11-09' }];
    expect(filterEvents(events, { ...EMPTY_FILTERS, city: 'تهران', src: 'wa' })).toEqual([events[1]]);
  });
});

describe('groups and segments', () => {
  it('groupNps: largest first, unknown bucket last, low-sample flag under n = 10', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => row(10, { city: 'تهران' })),
      row(0, { city: 'مشهد' }),
      row(9),
    ];
    const groups = groupNps(rows, (r) => r.city);
    expect(groups.map((g) => [g.label, g.n, g.nps, g.lowSample])).toEqual([
      ['تهران', 10, 100, false],
      ['مشهد', 1, -100, true],
      ['نامشخص', 1, 100, true],
    ]);
  });

  it('funnel counts distinct sessions per step with drop-off', () => {
    const ev = (s: string, type: string) => ({ sessionId: s, type, src: 'sms', day: '2026-11-08' });
    const steps = funnel([
      ev('a', 'view'), ev('a', 'view'), ev('b', 'view'), ev('c', 'view'), ev('d', 'view'),
      ev('a', 'score_selected'), ev('b', 'score_selected'),
      ev('a', 'step2_done'), ev('a', 'submitted'),
    ]);
    expect(steps.map((s) => [s.key, s.count])).toEqual([['view', 4], ['score_selected', 2], ['step2_done', 1], ['submitted', 1]]);
    expect(steps[1]?.ofFirst).toBe(0.5);
    expect(steps[1]?.dropFromPrev).toBe(0.5);
    expect(steps[0]?.dropFromPrev).toBeNull();
    expect(funnel([])[0]?.ofFirst).toBeNull();
  });
});

describe('why?', () => {
  const rows = [
    row(10, { drivers: ['quality'] }),
    row(9, { drivers: ['quality', 'price'] }),
    row(10, { drivers: ['quality'] }),
    row(8, { drivers: ['delivery'] }),
    row(2, { drivers: ['price', 'delivery'] }),
    row(5, { drivers: ['price'] }),
  ];

  it('driver matrix counts per category, strengths first', () => {
    const m = driverMatrix(rows, drivers);
    expect(m.map((d) => [d.id, d.promoters, d.passives, d.detractors])).toEqual([
      ['quality', 3, 0, 0], // net +3
      ['price', 1, 0, 2], // net −1, tie broken by more promoters
      ['delivery', 0, 1, 1], // net −1
    ]);
    expect(m[0]?.ofPromoters).toBe(1);
    expect(m[1]?.ofDetractors).toBe(1);
  });

  it('top strengths come from promoters, top pains from detractors + passives', () => {
    const { strengths, pains } = strengthsAndPains(rows, drivers);
    expect(strengths.map((h) => [h.label, h.count])).toEqual([['کیفیت', 3], ['قیمت', 1]]);
    expect(pains.map((h) => [h.label, h.count])).toEqual([['ارسال', 2], ['قیمت', 2]]);
    expect(pains[0]?.share).toBeCloseTo(2 / 3, 10);
  });

  it('theme breakdown by category drops empty themes and sorts by total', () => {
    const t = themeBreakdown(
      [row(2, { themes: ['delivery'] }), row(9, { themes: ['quality', 'delivery'] }), row(3, { themes: ['delivery'] })],
      [{ id: 'quality', label: 'کیفیت' }, { id: 'delivery', label: 'ارسال' }, { id: 'price', label: 'قیمت' }],
    );
    expect(t).toEqual([
      { id: 'delivery', label: 'ارسال', promoter: 1, passive: 0, detractor: 2, total: 3 },
      { id: 'quality', label: 'کیفیت', promoter: 1, passive: 0, detractor: 0, total: 1 },
    ]);
  });

  it('quotes: featured first, then the longest, alternating detractor / promoter, skipping one-word comments', () => {
    const q = [
      row(1, { comment: 'سفارش خیلی دیر رسید و جنس کم بود' }),
      row(10, { comment: 'کیفیت عالی و برخورد خوب کارشناس' }),
      row(9, { comment: 'خوب است، ممنون از شما', featured: true }),
      row(2, { comment: 'گران' }),
      row(10, { comment: 'همیشه به‌موقع و تمیز تحویل می‌دهند؛ راضی هستیم' }),
    ];
    const picked = selectQuotes(q, 3);
    expect(picked.map((r) => r.comment)).toEqual([
      'خوب است، ممنون از شما',
      'سفارش خیلی دیر رسید و جنس کم بود',
      'همیشه به‌موقع و تمیز تحویل می‌دهند؛ راضی هستیم',
    ]);
  });

  it('follow-up list: detractors only, tier A first, unhandled before handled, overdue after 48h', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    const list = followupList(
      [
        row(1, { tier: 'C', createdAt: '2026-11-08T08:00:00Z' }),
        row(4, { tier: 'A', followupStatus: 'called', createdAt: '2026-11-08T08:00:00Z' }),
        row(5, { tier: 'A', createdAt: '2026-11-12T10:00:00Z' }),
        row(9, { tier: 'A' }),
      ],
      now,
    );
    expect(list.map((r) => [r.score, r.tier, r.followupStatus, r.overdue])).toEqual([
      [5, 'A', 'todo', false],
      [4, 'A', 'called', false],
      [1, 'C', 'todo', true],
    ]);
  });
});

describe('campaignDays', () => {
  it('covers every Tehran day of the window plus data days', () => {
    const days = campaignDays(new Date('2026-11-08T08:00:00+03:30'), new Date('2026-11-14T23:59:59+03:30'), ['2026-11-20']);
    expect(days).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-20']);
  });
});
