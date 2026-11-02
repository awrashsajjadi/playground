// Dashboard analytics — pure functions over plain rows (no I/O). With a few thousand rows at most,
// computing in TypeScript is simpler to read and test than SQL aggregation.
import { tehranDayKey } from './date.ts';
import { npsFromCounts, type Category, type NpsSummary } from './nps.ts';
import { normalizeFa } from './themes.ts';

export interface Row {
  id: number;
  mobile: string;
  score: number;
  category: Category;
  drivers: string[];
  comment: string | null;
  contactOk: boolean;
  src: string;
  rep: string | null;
  durationMs: number | null;
  createdAt: string;
  day: string;
  followupStatus: string;
  followupNote: string | null;
  followupBy: string | null;
  followupAt: string | null;
  themes: string[];
  featured: boolean;
  customerId: number | null;
  name: string | null;
  company: string | null;
  city: string | null;
  province: string | null;
  customerType: string | null;
  tier: string | null;
  salesRep: string | null;
}

export interface CustomerLite {
  city: string | null;
  customerType: string | null;
  tier: string | null;
  salesRep: string | null;
}

export interface EventLite {
  sessionId: string;
  type: string;
  src: string;
  day: string;
}

export interface Filters {
  from: string | null;
  to: string | null;
  src: string | null;
  city: string | null;
  type: string | null;
  tier: string | null;
  rep: string | null;
  matchedOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  from: null, to: null, src: null, city: null, type: null, tier: null, rep: null, matchedOnly: false,
};

export const LOW_SAMPLE = 10;
export const OVERDUE_MS = 48 * 3600_000;

/** The assigned rep of a matched customer, otherwise the rep code from the link. */
export function effectiveRep(row: Pick<Row, 'salesRep' | 'rep'>): string | null {
  return row.salesRep ?? row.rep ?? null;
}

export function toDayKey(iso: string): string {
  return tehranDayKey(iso);
}

export function filterRows(rows: readonly Row[], f: Filters): Row[] {
  return rows.filter(
    (r) =>
      (!f.from || r.day >= f.from) &&
      (!f.to || r.day <= f.to) &&
      (!f.src || r.src === f.src) &&
      (!f.city || r.city === f.city) &&
      (!f.type || r.customerType === f.type) &&
      (!f.tier || r.tier === f.tier) &&
      (!f.rep || effectiveRep(r) === f.rep) &&
      (!f.matchedOnly || r.customerId !== null),
  );
}

/** Denominator for the response rate: customers in the list that match the customer-level filters. */
export function filterCustomers(customers: readonly CustomerLite[], f: Filters): CustomerLite[] {
  return customers.filter(
    (c) =>
      (!f.city || c.city === f.city) &&
      (!f.type || c.customerType === f.type) &&
      (!f.tier || c.tier === f.tier) &&
      (!f.rep || c.salesRep === f.rep),
  );
}

/** Funnel events carry no customer data, so only the date range and channel apply. */
export function filterEvents(events: readonly EventLite[], f: Filters): EventLite[] {
  return events.filter((e) => (!f.from || e.day >= f.from) && (!f.to || e.day <= f.to) && (!f.src || e.src === f.src));
}

export function summarize(rows: readonly Row[]): NpsSummary {
  let p = 0;
  let pa = 0;
  let d = 0;
  let sum = 0;
  for (const r of rows) {
    if (r.category === 'promoter') p++;
    else if (r.category === 'passive') pa++;
    else d++;
    sum += r.score;
  }
  return npsFromCounts(p, pa, d, sum);
}

export function histogram(rows: readonly Row[]): number[] {
  const counts = Array.from({ length: 11 }, () => 0);
  for (const r of rows) counts[r.score] = (counts[r.score] ?? 0) + 1;
  return counts;
}

export interface DailyPoint {
  day: string;
  count: number;
  /** NPS of everything received up to and including this day; null before the first response. */
  cumulativeNps: number | null;
}

export function daily(rows: readonly Row[], days: readonly string[]): DailyPoint[] {
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }
  let p = 0;
  let pa = 0;
  let d = 0;
  return days.map((day) => {
    const list = byDay.get(day) ?? [];
    for (const r of list) {
      if (r.category === 'promoter') p++;
      else if (r.category === 'passive') pa++;
      else d++;
    }
    return { day, count: list.length, cumulativeNps: npsFromCounts(p, pa, d).nps };
  });
}

export interface SegmentRow {
  key: string;
  label: string;
  n: number;
  nps: number | null;
  moe: number | null;
  pctPromoters: number | null;
  pctDetractors: number | null;
  lowSample: boolean;
}

export const UNKNOWN_KEY = '__unknown__';

/** NPS per group. Rows without a value go to one «نامشخص» bucket. Largest groups first. */
export function groupNps(
  rows: readonly Row[],
  keyOf: (r: Row) => string | null,
  labelOf: (key: string) => string = (k) => k,
): SegmentRow[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = keyOf(r) ?? UNKNOWN_KEY;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const s = summarize(list);
      return {
        key,
        label: key === UNKNOWN_KEY ? 'نامشخص' : labelOf(key),
        n: s.n,
        nps: s.nps,
        moe: s.moe,
        pctPromoters: s.pctPromoters,
        pctDetractors: s.pctDetractors,
        lowSample: s.n < LOW_SAMPLE,
      };
    })
    .sort((a, b) => (a.key === UNKNOWN_KEY ? 1 : 0) - (b.key === UNKNOWN_KEY ? 1 : 0) || b.n - a.n || a.label.localeCompare(b.label, 'fa'));
}

export interface FunnelStep {
  key: 'view' | 'score_selected' | 'step2_done' | 'submitted';
  count: number;
  /** Share of the first step (views). */
  ofFirst: number | null;
  /** Share lost since the previous step. */
  dropFromPrev: number | null;
}

export function funnel(events: readonly EventLite[]): FunnelStep[] {
  const keys = ['view', 'score_selected', 'step2_done', 'submitted'] as const;
  const sessions = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]));
  for (const e of events) sessions.get(e.type)?.add(e.sessionId);
  const counts = keys.map((k) => sessions.get(k)?.size ?? 0);
  const first = counts[0] ?? 0;
  return keys.map((key, i) => {
    const count = counts[i] ?? 0;
    const prev = i === 0 ? null : (counts[i - 1] ?? 0);
    return {
      key,
      count,
      ofFirst: first > 0 ? count / first : null,
      dropFromPrev: prev ? 1 - count / prev : null,
    };
  });
}

export interface DriverStat {
  id: string;
  label: string;
  promoters: number;
  passives: number;
  detractors: number;
  /** Share of promoters / detractors who picked it (0..1); null when the group is empty. */
  ofPromoters: number | null;
  ofDetractors: number | null;
}

/** For each chip: how often promoters vs detractors picked it. Strengths first, pains last. */
export function driverMatrix(rows: readonly Row[], drivers: readonly { id: string; label: string }[]): DriverStat[] {
  const s = summarize(rows);
  const stats = drivers.map((d) => {
    let promoters = 0;
    let passives = 0;
    let detractors = 0;
    for (const r of rows) {
      if (!r.drivers.includes(d.id)) continue;
      if (r.category === 'promoter') promoters++;
      else if (r.category === 'passive') passives++;
      else detractors++;
    }
    return {
      id: d.id,
      label: d.label,
      promoters,
      passives,
      detractors,
      ofPromoters: s.promoters ? promoters / s.promoters : null,
      ofDetractors: s.detractors ? detractors / s.detractors : null,
    };
  });
  return stats.sort((a, b) => b.promoters - b.detractors - (a.promoters - a.detractors) || b.promoters - a.promoters);
}

export interface Highlight {
  id: string;
  label: string;
  count: number;
  /** Share of the group that picked it (0..1). */
  share: number | null;
}

/** Top 3 strengths (chips promoters picked) and top 3 pains (chips detractors + passives picked). */
export function strengthsAndPains(rows: readonly Row[], drivers: readonly { id: string; label: string }[]) {
  const s = summarize(rows);
  const critics = s.detractors + s.passives;
  const top = (count: (d: DriverStat) => number, total: number): Highlight[] =>
    driverMatrix(rows, drivers)
      .map((d) => ({ id: d.id, label: d.label, count: count(d), share: total ? count(d) / total : null }))
      .filter((h) => h.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fa'))
      .slice(0, 3);
  return {
    strengths: top((d) => d.promoters, s.promoters),
    pains: top((d) => d.detractors + d.passives, critics),
  };
}

export interface ThemeStat {
  id: string;
  label: string;
  promoter: number;
  passive: number;
  detractor: number;
  total: number;
}

export function themeBreakdown(rows: readonly Row[], themes: readonly { id: string; label: string }[]): ThemeStat[] {
  return themes
    .map((t) => {
      const stat = { id: t.id, label: t.label, promoter: 0, passive: 0, detractor: 0, total: 0 };
      for (const r of rows) {
        if (!r.themes.includes(t.id)) continue;
        stat[r.category]++;
        stat.total++;
      }
      return stat;
    })
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Featured quotes first (newest first), then the longest comments, alternating detractor/promoter. Identical texts once. */
export function selectQuotes(rows: readonly Row[], limit = 10): Row[] {
  const seen = new Set<string>();
  const usable = rows.filter((r) => {
    const text = normalizeFa(r.comment ?? '');
    if (text.length < 12 || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
  const featured = usable.filter((r) => r.featured).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const picked = featured.slice(0, limit);
  const byLength = (cat: Category) =>
    usable
      .filter((r) => !r.featured && r.category === cat)
      .sort((a, b) => (b.comment?.length ?? 0) - (a.comment?.length ?? 0) || a.id - b.id);
  const pools = [byLength('detractor'), byLength('promoter'), byLength('passive')];
  let turn = 0;
  while (picked.length < limit && pools.some((p) => p.length > 0)) {
    const pool = pools[turn % 2 === 0 ? 0 : 1]?.length ? pools[turn % 2 === 0 ? 0 : 1] : pools.find((p) => p.length > 0);
    const next = pool?.shift();
    if (next) picked.push(next);
    turn++;
  }
  return picked;
}

const TIER_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };

/** Detractors to call back: tier A first, then unhandled, then oldest. */
export function followupList(rows: readonly Row[], nowMs: number) {
  return rows
    .filter((r) => r.category === 'detractor')
    .map((r) => ({ ...r, overdue: r.followupStatus === 'todo' && nowMs - Date.parse(r.createdAt) > OVERDUE_MS }))
    .sort(
      (a, b) =>
        (TIER_ORDER[a.tier ?? ''] ?? 3) - (TIER_ORDER[b.tier ?? ''] ?? 3) ||
        Number(b.followupStatus === 'todo') - Number(a.followupStatus === 'todo') ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Campaign days (Tehran calendar) plus any day that has data, capped to 62 days. */
export function campaignDays(opensAt: Date, closesAt: Date, dataDays: Iterable<string>): string[] {
  const set = new Set<string>();
  for (let t = opensAt.getTime(); t <= closesAt.getTime() + 1; t += 86_400_000) set.add(tehranDayKey(new Date(t)));
  set.add(tehranDayKey(closesAt));
  for (const d of dataDays) set.add(d);
  return [...set].sort().slice(-62);
}
