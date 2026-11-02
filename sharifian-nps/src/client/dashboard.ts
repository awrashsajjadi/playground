// Dashboard & report: Chart.js charts (tree-shaken), comment-wall search, inline follow-up updates,
// featured-quote stars, auto-refresh, and the print button. Data comes from <script id="dash-data">.
import {
  BarController, BarElement, CategoryScale, Chart, LinearScale, LineController, LineElement, PointElement, Tooltip,
  type ChartConfiguration, type ScriptableScaleContext,
} from 'chart.js';
import { faDigits } from '../core/fa.ts';
import { normalizeFa } from '../core/themes.ts';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip);

type Cat = 'detractor' | 'passive' | 'promoter';

interface ChartData {
  colors: Record<Cat | 'series' | 'grid' | 'axis' | 'text' | 'muted', string> & { funnel: string[] };
  histogram: { labels: string[]; counts: number[]; categories: Cat[] };
  trend: { labels: string[]; counts: number[]; nps: (number | null)[] };
  drivers: { labels: string[]; promoters: number[]; detractors: number[] };
  themes: { labels: string[]; detractor: number[]; passive: number[]; promoter: number[] };
  labels: Record<Cat, string>;
}

const nf = new Intl.NumberFormat('fa-IR');
const num = (v: number | string) => nf.format(Number(v));
// Signed numbers are wrapped in an LTR isolate: in RTL canvas text "+۵۰" would otherwise render as "۵۰+".
const signed = (v: number) =>
  `\u2066${v > 0 ? `+${num(v)}` : v < 0 ? `\u2212${num(Math.abs(v))}` : num(0)}\u2069`;
/** Rounds an axis end up to a clean step (no "۵۳" at the edge). */
const niceStep = (v: number) => (v <= 10 ? 2 : v <= 50 ? 10 : v <= 200 ? 20 : 50);
const niceCeil = (v: number) => Math.ceil(v / niceStep(v)) * niceStep(v);
const report = document.body.dataset.mode === 'report';
const charts: Chart[] = [];

function draw(data: ChartData): void {
  const c = data.colors;
  Chart.defaults.font.family = 'Vazirmatn, Tahoma, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = c.muted;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.layout.padding = { left: 18, right: 4, top: 6, bottom: 0 };
  Chart.defaults.animation = false;
  Chart.defaults.plugins.tooltip.rtl = true;
  Chart.defaults.plugins.tooltip.textDirection = 'rtl';
  Chart.defaults.plugins.tooltip.titleFont = { family: 'Vazirmatn, Tahoma, sans-serif', weight: 'bold' };
  Chart.defaults.plugins.tooltip.bodyFont = { family: 'Vazirmatn, Tahoma, sans-serif' };
  if (report) Chart.defaults.devicePixelRatio = 2;

  const make = (id: string, config: ChartConfiguration) => {
    const canvas = document.getElementById(id) as HTMLCanvasElement | null;
    if (canvas) charts.push(new Chart(canvas, config));
  };
  const zeroLine = (ctx: ScriptableScaleContext) => (ctx.tick?.value === 0 ? c.axis : c.grid);
  const countAxis = { beginAtZero: true, position: 'right' as const, ticks: { precision: 0, callback: (v: number | string) => num(v) }, grid: { color: c.grid }, border: { display: false } };
  // RTL: categories read right-to-left, so the x axis is reversed and the value axis sits on the right.
  const categoryAxis = { reverse: true, grid: { display: false }, border: { color: c.axis } };

  make('ch-hist', {
    type: 'bar',
    data: {
      labels: data.histogram.labels,
      datasets: [{
        data: data.histogram.counts,
        backgroundColor: data.histogram.categories.map((cat) => c[cat]),
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 24,
      }],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `امتیاز ${items[0]?.label ?? ''}`,
            label: (item) => `${num(item.parsed.y ?? 0)} پاسخ — ${data.labels[data.histogram.categories[item.dataIndex] ?? 'passive']}`,
          },
        },
      },
      scales: { x: categoryAxis, y: countAxis },
    },
  });

  const npsValues = data.trend.nps.filter((v): v is number => v !== null);
  const lo = Math.max(-100, Math.floor((Math.min(0, ...npsValues) - 10) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(0, ...npsValues) + 10) / 10) * 10);
  make('ch-nps', {
    type: 'line',
    data: {
      labels: data.trend.labels,
      datasets: [{
        data: data.trend.nps,
        borderColor: c.series,
        backgroundColor: c.series,
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        spanGaps: true,
        tension: 0,
      }],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `NPS تجمعی: ${signed(item.parsed.y ?? 0)}` } },
      },
      scales: {
        x: categoryAxis,
        y: { position: 'right', min: lo, max: hi, ticks: { stepSize: 10, callback: (v) => signed(Number(v)) }, grid: { color: zeroLine }, border: { display: false } },
      },
    },
  });

  make('ch-daily', {
    type: 'bar',
    data: {
      labels: data.trend.labels,
      datasets: [{ data: data.trend.counts, backgroundColor: c.series, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 }],
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => `${num(item.parsed.y ?? 0)} پاسخ` } } },
      scales: { x: categoryAxis, y: countAxis },
    },
  });

  // Diverging: promoters grow left (negative values), detractors grow right; labels on the right edge.
  const reach = niceCeil(Math.max(1, ...data.drivers.promoters, ...data.drivers.detractors));
  make('ch-drivers', {
    type: 'bar',
    data: {
      labels: data.drivers.labels,
      datasets: [
        { label: 'مروجان', data: data.drivers.promoters.map((v) => -v), backgroundColor: c.promoter, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18 },
        { label: 'منتقدان', data: data.drivers.detractors, backgroundColor: c.detractor, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18 },
      ],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${num(Math.abs(item.parsed.x ?? 0))}` } },
      },
      scales: {
        x: { stacked: true, min: -reach, max: reach, ticks: { precision: 0, stepSize: niceStep(reach), callback: (v) => num(Math.abs(Number(v))) }, grid: { color: zeroLine }, border: { display: false } },
        y: { stacked: true, position: 'right', grid: { display: false }, border: { color: c.axis } },
      },
    },
  });

  const cats: Cat[] = ['detractor', 'passive', 'promoter'];
  make('ch-themes', {
    type: 'bar',
    data: {
      labels: data.themes.labels,
      datasets: cats.map((cat) => ({
        label: data.labels[cat],
        data: data.themes[cat],
        backgroundColor: c[cat],
        borderColor: '#ffffff',
        borderWidth: { left: 1, right: 1 },
        borderSkipped: false,
        maxBarThickness: 18,
      })),
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${num(item.parsed.x ?? 0)}` } },
      },
      scales: {
        x: { stacked: true, reverse: true, beginAtZero: true, ticks: { precision: 0, callback: (v) => num(v) }, grid: { color: c.grid }, border: { display: false } },
        y: { stacked: true, position: 'right', grid: { display: false }, border: { color: c.axis } },
      },
    },
  });

  window.addEventListener('beforeprint', () => charts.forEach((chart) => chart.resize()));
}

function csrf(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': csrf() },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

let dirty = false;

function initWall(): void {
  const search = document.getElementById('wall-search') as HTMLInputElement | null;
  const items = Array.prototype.slice.call(document.querySelectorAll('.wall .quote')) as HTMLElement[];
  const count = document.getElementById('wall-count');
  const empty = document.getElementById('wall-empty');
  const buttons = Array.prototype.slice.call(document.querySelectorAll('.seg-buttons button')) as HTMLButtonElement[];
  if (!search) return;
  let cat = 'all';
  const apply = () => {
    const q = normalizeFa(search.value);
    let shown = 0;
    for (const li of items) {
      const ok = (cat === 'all' || li.dataset.cat === cat) && (!q || (li.dataset.search ?? '').includes(q));
      li.hidden = !ok;
      if (ok) shown++;
    }
    if (count) count.textContent = `(${faDigits(shown)})`;
    if (empty) empty.hidden = shown > 0;
  };
  search.addEventListener('input', apply);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      cat = button.dataset.cat ?? 'all';
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
      apply();
    });
  }
}

function initActions(): void {
  document.addEventListener('submit', async (event) => {
    const form = event.target as HTMLFormElement;
    if (form.classList.contains('fu-form')) {
      event.preventDefault();
      const status = (form.elements.namedItem('status') as HTMLSelectElement | null)?.value;
      const note = (form.elements.namedItem('note') as HTMLInputElement | null)?.value ?? '';
      const button = form.querySelector('button');
      if (button) button.disabled = true;
      const result = await postJson(form.action, { status, note });
      if (button) button.disabled = false;
      const row = form.closest('tr');
      const meta = row?.querySelector<HTMLElement>('[data-meta]');
      if (result && meta) {
        meta.textContent = `✓ ذخیره شد — ${String(result.by)} · ${String(result.at)}`;
        meta.classList.add('saved');
        if (status !== 'todo') row?.classList.remove('overdue');
        dirty = false;
      } else if (meta) {
        meta.textContent = 'ذخیره نشد؛ دوباره تلاش کنید.';
      }
    }
    if (form.classList.contains('star-form')) {
      event.preventDefault();
      const input = form.querySelector<HTMLInputElement>('input[name="featured"]');
      const button = form.querySelector<HTMLButtonElement>('button');
      if (!input || !button) return;
      const featured = input.value === '1';
      const result = await postJson(form.action, { featured });
      if (!result) return;
      input.value = featured ? '0' : '1';
      button.setAttribute('aria-pressed', String(featured));
      const icon = button.querySelector('[aria-hidden]');
      if (icon) icon.textContent = featured ? '★' : '☆';
    }
  });
  // Status changes save immediately; notes save with the button (or Enter).
  document.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.name === 'status' && select.form?.classList.contains('fu-form')) select.form.requestSubmit();
  });
  document.addEventListener('input', (event) => {
    if ((event.target as HTMLElement).closest('.followups')) dirty = true;
  });
}

function initRefresh(): void {
  const toggle = document.getElementById('auto-refresh') as HTMLInputElement | null;
  if (!toggle) return;
  try {
    toggle.checked = localStorage.getItem('nps-auto-refresh') !== '0';
  } catch {
    /* storage blocked: keep the default */
  }
  toggle.addEventListener('change', () => {
    try {
      localStorage.setItem('nps-auto-refresh', toggle.checked ? '1' : '0');
    } catch {
      /* ignore */
    }
  });
  window.setInterval(() => {
    if (!toggle.checked || dirty || document.visibilityState !== 'visible') return;
    const active = document.activeElement;
    if (active && active !== document.body && active.closest('.followups, .filters, .wall-head, .quote')) return;
    window.location.reload();
  }, 60_000);
}

function init(): void {
  const raw = document.getElementById('dash-data')?.textContent;
  if (raw) {
    const data = JSON.parse(raw) as ChartData;
    const ready = document.fonts?.ready ?? Promise.resolve();
    ready.then(() => draw(data), () => draw(data));
  }
  document.getElementById('print-btn')?.addEventListener('click', () => window.print());
  initWall();
  initActions();
  initRefresh();
}

init();
