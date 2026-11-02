// Builds the dashboard / report view-model: one read of the data, filters, then pure analytics.
import {
  campaignDays, daily, driverMatrix, filterCustomers, filterEvents, filterRows, followupList, funnel, groupNps,
  histogram, median, selectQuotes, strengthsAndPains, summarize, themeBreakdown, toDayKey, type Filters, type Row,
} from '../core/analytics.ts';
import { faDayMonth, faFullDateTime, faNumericDate, faWeekdayDate } from '../core/date.ts';
import { faDigits } from '../core/fa.ts';
import { CATEGORY_LABELS } from '../core/labels.ts';
import type { Category } from '../core/nps.ts';
import type { AppContext } from '../context.ts';
import type { ResponseRow } from '../db/repo.ts';

/** Chart colors — validated with the dataviz palette checks (CVD + normal-vision + contrast on white). */
export const CHART_COLORS = {
  detractor: '#e06a3f',
  passive: '#8c877e',
  promoter: '#1f6f3a',
  series: '#1f6f3a',
  funnel: ['#7fb58f', '#4f9a66', '#2b7a44', '#155c2e'],
  grid: '#ebe6dd',
  axis: '#cfc8bc',
  text: '#1c1917',
  muted: '#6f6a63',
} as const;

export const FUNNEL_LABELS: Record<string, string> = {
  view: 'بازدید صفحه',
  score_selected: 'انتخاب امتیاز',
  step2_done: 'تکمیل گام ۲',
  submitted: 'ثبت نهایی',
};

const TIERS = ['A', 'B', 'C'];

function toRow(r: ResponseRow): Row {
  const parse = (json: string) => {
    try {
      const v = JSON.parse(json) as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  return {
    id: r.id,
    mobile: r.mobile,
    score: r.score,
    category: r.category,
    drivers: parse(r.drivers),
    comment: r.comment,
    contactOk: r.contact_ok === 1,
    src: r.src,
    rep: r.rep,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
    day: toDayKey(r.created_at),
    followupStatus: r.followup_status,
    followupNote: r.followup_note,
    followupBy: r.followup_by,
    followupAt: r.followup_at,
    themes: parse(r.theme_tags),
    featured: r.featured === 1,
    customerId: r.customer_id,
    name: r.name,
    company: r.company,
    city: r.city,
    province: r.province,
    customerType: r.customer_type,
    tier: r.value_tier,
    salesRep: r.sales_rep,
  };
}

const uniqSorted = (values: Iterable<string | null>) =>
  [...new Set([...values].filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'fa'));

export function loadDashboard(ctx: AppContext, query: Record<string, unknown>) {
  const { config, repo } = ctx;
  const now = ctx.now();
  const survey = config.survey;

  const all = repo.responsesForExport().map(toRow);
  const customers = repo.customersLite().map((c) => ({
    city: c.city, customerType: c.customer_type, tier: c.value_tier, salesRep: c.sales_rep,
  }));
  const events = repo.events().map((e) => ({ sessionId: e.session_id, type: e.type, src: e.src, day: toDayKey(e.created_at) }));

  // Filter options come from the data (and config), so a value can never be invented in the URL.
  const days = campaignDays(config.opensAt, config.closesAt, all.map((r) => r.day));
  const repLabel = (code: string) => (survey.reps[code] ? `${survey.reps[code]} (${code})` : code);
  const options = {
    days: days.map((key) => ({ key, label: faWeekdayDate(`${key}T12:00:00+03:30`) })),
    channels: Object.entries(survey.channels).map(([key, label]) => ({ key, label })),
    cities: uniqSorted(customers.map((c) => c.city)),
    types: uniqSorted(customers.map((c) => c.customerType)),
    tiers: TIERS,
    reps: uniqSorted([...customers.map((c) => c.salesRep), ...repo.responseReps(), ...Object.keys(survey.reps)]).map(
      (key) => ({ key, label: repLabel(key) }),
    ),
  };

  const pick = (value: unknown, allowed: readonly string[]) =>
    typeof value === 'string' && allowed.includes(value) ? value : null;
  const dayKeys = days;
  let from = pick(query.from, dayKeys);
  let to = pick(query.to, dayKeys);
  if (from && to && from > to) [from, to] = [to, from];
  const filters: Filters = {
    from,
    to,
    src: pick(query.src, Object.keys(survey.channels)),
    city: pick(query.city, options.cities),
    type: pick(query.type, options.types),
    tier: pick(query.tier, TIERS),
    rep: pick(query.rep, options.reps.map((r) => r.key)),
    matchedOnly: query.matched === '1',
  };
  const active = Object.entries(filters).some(([, v]) => v !== null && v !== false);

  const rows = filterRows(all, filters);
  const summary = summarize(rows);
  const customerCount = filterCustomers(customers, filters).length;
  const matched = rows.filter((r) => r.customerId !== null).length;
  const followups = followupList(rows, now.getTime());
  const durations = rows.map((r) => r.durationMs).filter((v): v is number => v !== null && v > 0);
  const shownDays = days.filter((d) => (!filters.from || d >= filters.from) && (!filters.to || d <= filters.to));
  // The cumulative line stops today: carrying it into campaign days that have not happened yet would invent data.
  const today = toDayKey(now.toISOString());
  const trend = daily(rows, shownDays).map((p) => (p.day > today ? { ...p, cumulativeNps: null } : p));
  const drivers = driverMatrix(rows, survey.drivers);
  const themes = themeBreakdown(rows, config.themes);
  const driverLabels = new Map(survey.drivers.map((d) => [d.id, d.label]));
  const themeLabels = new Map(config.themes.map((t) => [t.id, t.label]));
  const describe = (r: Row) => ({
    ...r,
    categoryLabel: CATEGORY_LABELS[r.category],
    when: faNumericDate(r.createdAt),
    whenFull: faFullDateTime(r.createdAt),
    driverLabels: r.drivers.map((id) => driverLabels.get(id) ?? id),
    themeLabels: r.themes.map((id) => themeLabels.get(id) ?? id),
    channel: survey.channels[r.src] ?? r.src,
    repShown: r.salesRep ?? r.rep,
  });

  const hist = histogram(rows);
  const categoryOf = (score: number): Category => (score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor');

  return {
    now,
    generatedAt: faFullDateTime(now),
    filters,
    active,
    query: new URLSearchParams(
      Object.entries({
        from: filters.from, to: filters.to, src: filters.src, city: filters.city, type: filters.type,
        tier: filters.tier, rep: filters.rep, matched: filters.matchedOnly ? '1' : null,
      }).filter((e): e is [string, string] => e[1] !== null),
    ).toString(),
    periodLabel: `${faWeekdayDate(`${shownDays[0] ?? days[0]}T12:00:00+03:30`)} تا ${faWeekdayDate(`${shownDays.at(-1) ?? days.at(-1)}T12:00:00+03:30`)}`,
    options,
    summary,
    customers: customerCount,
    matched,
    responseRate: customerCount > 0 ? matched / customerCount : null,
    todo: followups.filter((f) => f.followupStatus === 'todo').length,
    overdue: followups.filter((f) => f.overdue).length,
    medianSeconds: (() => {
      const m = median(durations);
      return m === null ? null : Math.round(m / 1000);
    })(),
    histogram: hist.map((count, score) => ({ score, count, category: categoryOf(score) })),
    trend: trend.map((p) => ({ ...p, label: faDayMonth(`${p.day}T12:00:00+03:30`) })),
    channels: groupNps(rows, (r) => r.src, (k) => survey.channels[k] ?? k),
    funnel: funnel(filterEvents(events, filters)).map((s) => ({ ...s, label: FUNNEL_LABELS[s.key] ?? s.key })),
    drivers,
    themes,
    segments: [
      { id: 'city', title: 'شهر', rows: groupNps(rows, (r) => r.city) },
      { id: 'type', title: 'نوع مشتری', rows: groupNps(rows, (r) => r.customerType) },
      { id: 'tier', title: 'سطح ارزش (Tier)', rows: groupNps(rows, (r) => r.tier, (k) => `سطح ${k}`) },
      { id: 'rep', title: 'کارشناس فروش', rows: groupNps(rows, (r) => r.salesRep ?? r.rep, repLabel) },
    ],
    ...strengthsAndPains(rows, survey.drivers),
    comments: rows
      .filter((r) => r.comment)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(describe),
    followups: followups.map((f) => ({ ...describe(f), overdue: f.overdue })),
    quotes: selectQuotes(rows).map(describe),
    chart: {
      colors: CHART_COLORS,
      histogram: {
        labels: hist.map((_, i) => faDigits(i)),
        counts: hist,
        categories: hist.map((_, i) => categoryOf(i)),
      },
      trend: {
        labels: trend.map((p) => faDayMonth(`${p.day}T12:00:00+03:30`)),
        counts: trend.map((p) => p.count),
        nps: trend.map((p) => (p.cumulativeNps === null ? null : Math.round(p.cumulativeNps * 10) / 10)),
      },
      drivers: {
        labels: drivers.map((d) => d.label),
        promoters: drivers.map((d) => d.promoters),
        detractors: drivers.map((d) => d.detractors),
      },
      themes: {
        labels: themes.map((t) => t.label),
        detractor: themes.map((t) => t.detractor),
        passive: themes.map((t) => t.passive),
        promoter: themes.map((t) => t.promoter),
      },
      labels: CATEGORY_LABELS,
    },
  };
}

export type DashboardData = ReturnType<typeof loadDashboard>;

export const FOLLOWUP_STATUSES = ['todo', 'called', 'resolved', 'unreachable'] as const;
