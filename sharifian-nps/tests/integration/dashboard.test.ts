import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { faNumber, faSigned } from '../../src/core/fa.ts';
import { clearDemo, DEMO_CUSTOMERS, DEMO_RESPONSES, hasRealData, seedDemo } from '../../src/services/demo.ts';
import { count, createTestApp, getToken, login, submitJson, type TestApp } from '../helpers.ts';

let t: TestApp;
let auth: { cookie: string; csrf: string };

beforeEach(async () => {
  t = await createTestApp();
  auth = await login(t.app, 'سارا');
});
afterEach(async () => {
  await t.app.close();
});

const get = (url: string) => t.app.inject({ url, headers: { cookie: auth.cookie } });

/** NPS and margin of error computed straight from the table, independent of the app code. */
function npsFromDb(where = "kind <> 'test'") {
  const r = t.db
    .prepare(`SELECT SUM(category = 'promoter') p, SUM(category = 'detractor') d, COUNT(*) n FROM responses WHERE ${where}`)
    .get() as { p: number; d: number; n: number };
  const p = r.p / r.n;
  const d = r.d / r.n;
  return { nps: (p - d) * 100, moe: 1.96 * Math.sqrt((p + d - (p - d) ** 2) / r.n) * 100, n: r.n };
}

describe('demo data', () => {
  it('seeds 500 customers and 180 responses, all marked as demo; clear removes only demo rows', async () => {
    const result = seedDemo(t.db, t.config);
    expect(result).toMatchObject({ customers: DEMO_CUSTOMERS, responses: DEMO_RESPONSES });
    expect(count(t.db, 'SELECT COUNT(*) n FROM customers WHERE is_demo = 1')).toBe(500);
    expect(count(t.db, "SELECT COUNT(*) n FROM responses WHERE kind = 'demo'")).toBe(180);
    expect(count(t.db, 'SELECT COUNT(*) n FROM responses WHERE customer_id IS NULL')).toBe(15);
    expect(count(t.db, "SELECT COUNT(*) n FROM responses WHERE comment IS NOT NULL")).toBeGreaterThan(90);
    expect(count(t.db, "SELECT COUNT(DISTINCT session_id) n FROM events WHERE type = 'view'")).toBe(352);
    expect(hasRealData(t.db)).toBe(false);

    // All demo responses fall inside the campaign window.
    const range = t.db.prepare("SELECT MIN(created_at) a, MAX(created_at) b FROM responses").get() as { a: string; b: string };
    expect(Date.parse(range.a)).toBeGreaterThanOrEqual(t.config.opensAt.getTime());
    expect(Date.parse(range.b)).toBeLessThanOrEqual(t.config.closesAt.getTime());

    // A real response arrives; clearing demo data must keep it.
    const tk = await getToken(t.app);
    t.advance(4000);
    expect((await submitJson(t.app, { tk, score: 9, mobile: '09120000001' })).statusCode).toBe(201);
    expect(hasRealData(t.db)).toBe(true);
    expect(clearDemo(t.db)).toEqual({ responses: 180, customers: 500, events: expect.any(Number) });
    expect(t.db.prepare('SELECT kind, mobile FROM responses').all()).toEqual([{ kind: 'live', mobile: '09120000001' }]);
    expect(count(t.db, "SELECT COUNT(*) n FROM events WHERE session_id LIKE 'demo-%'")).toBe(0);
  });

  it('is reproducible (fixed seed)', () => {
    seedDemo(t.db, t.config);
    const first = npsFromDb();
    seedDemo(t.db, t.config);
    expect(npsFromDb()).toEqual(first);
  });

  it('admin pages show the demo warning and exports get a DEMO- prefix', async () => {
    seedDemo(t.db, t.config);
    expect((await get('/admin')).body).toContain('داده‌ی نمایشی (دمو) در دیتابیس است');
    expect((await get('/admin/export/responses.csv')).headers['content-disposition']).toContain('DEMO-sharifian-nps-responses');
  });
});

describe('GET /admin/dashboard', () => {
  it('requires a session', async () => {
    const res = await t.app.inject({ url: '/admin/dashboard' });
    expect(res.statusCode).toBe(302);
  });

  it('renders every section, and the NPS ± margin matches a direct calculation', async () => {
    seedDemo(t.db, t.config);
    const res = await get('/admin/dashboard');
    expect(res.statusCode).toBe(200);
    const expected = npsFromDb();
    expect(res.body).toContain(`<strong class="hero" dir="ltr">${faSigned(expected.nps)}</strong>`);
    expect(res.body).toContain(`± ${faNumber(expected.moe, 1)}`);
    expect(res.body).toContain(`n = ${faNumber(180)}`);
    for (const marker of [
      'class="segbar"', 'id="ch-hist"', 'id="ch-nps"', 'id="ch-daily"', 'عملکرد کانال‌ها', 'class="funnel"',
      'id="ch-drivers"', 'id="ch-themes"', 'NPS به تفکیک سگمنت', 'id="comments"', 'id="followups"', 'id="dash-data"',
      '۳ نقطه‌ی قوت', '۳ نقطه‌ی درد',
    ]) {
      expect(res.body, marker).toContain(marker);
    }
    expect(res.body.match(/class="nps-table"/g)).toHaveLength(5); // channels + 4 segments
    expect(res.body).toContain('نمونه کم — قابل اتکا نیست');
    const data = JSON.parse(/<script type="application\/json" id="dash-data">(.*?)<\/script>/s.exec(res.body)![1]!);
    expect(data.histogram.counts.reduce((a: number, b: number) => a + b, 0)).toBe(180);
    expect(data.trend.labels).toHaveLength(7);
  });

  it('applies filters (and the KPI follows them); unknown filter values are ignored', async () => {
    seedDemo(t.db, t.config);
    const res = await get(`/admin/dashboard?city=${encodeURIComponent('تهران')}&matched=1`);
    const expected = npsFromDb("kind <> 'test' AND customer_id IN (SELECT id FROM customers WHERE city = 'تهران')");
    expect(res.body).toContain(`<strong class="hero" dir="ltr">${faSigned(expected.nps)}</strong>`);
    expect(res.body).toContain(`n = ${faNumber(expected.n)}`);
    const bogus = await get('/admin/dashboard?city=%3Cscript%3E&src=evil&from=1999-01-01');
    expect(bogus.statusCode).toBe(200);
    expect(bogus.body).toContain(`n = ${faNumber(180)}`);
  });

  it('shows an empty dashboard without errors', async () => {
    const res = await get('/admin/dashboard');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<strong class="hero" dir="ltr">—</strong>');
    expect(res.body).toContain('منتقدی در این بازه نیست.');
  });
});

describe('follow-up and featured actions', () => {
  async function detractorId(): Promise<number> {
    const tk = await getToken(t.app);
    t.advance(4000);
    await submitJson(t.app, { tk, score: 2, mobile: '09121234567', comment: 'دیر رسید و جنس کم بود' });
    return (t.db.prepare('SELECT id FROM responses').get() as { id: number }).id;
  }
  const post = (url: string, body: unknown, csrf = auth.csrf) =>
    t.app.inject({
      method: 'POST', url, payload: JSON.stringify(body),
      headers: { cookie: auth.cookie, 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': csrf },
    });

  it('updates status + note and records who and when', async () => {
    const id = await detractorId();
    const res = await post(`/admin/responses/${id}/followup`, { status: 'called', note: 'قرار شد بار بعدی جبران شود' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: 'called', statusLabel: 'تماس گرفته شد', by: 'سارا' });
    expect(t.db.prepare('SELECT followup_status s, followup_note n, followup_by b, followup_at a FROM responses').get()).toEqual({
      s: 'called', n: 'قرار شد بار بعدی جبران شود', b: 'سارا', a: expect.stringMatching(/^2026-11-09T/),
    });
    // The dashboard reflects it.
    const page = await get('/admin/dashboard');
    expect(page.body).toMatch(/<option value="called" selected>تماس گرفته شد<\/option>/);
  });

  it('rejects bad status (400), unknown id (404) and a missing CSRF token (403)', async () => {
    const id = await detractorId();
    expect((await post(`/admin/responses/${id}/followup`, { status: 'hacked' })).statusCode).toBe(400);
    expect((await post('/admin/responses/9999/followup', { status: 'called' })).statusCode).toBe(404);
    expect((await post(`/admin/responses/${id}/followup`, { status: 'called' }, 'nope')).statusCode).toBe(403);
  });

  it('works without JavaScript (form post → redirect back to the row)', async () => {
    const id = await detractorId();
    const res = await t.app.inject({
      method: 'POST', url: `/admin/responses/${id}/followup`,
      headers: { cookie: auth.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ _csrf: auth.csrf, status: 'resolved', note: '', back: 'tier=A' }).toString(),
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/admin/dashboard?tier=A#fu-${id}`);
    expect(count(t.db, "SELECT COUNT(*) n FROM responses WHERE followup_status = 'resolved'")).toBe(1);
  });

  it('toggles a featured quote', async () => {
    const id = await detractorId();
    expect((await post(`/admin/responses/${id}/featured`, { featured: true })).json()).toEqual({ ok: true, featured: true });
    expect(count(t.db, 'SELECT featured n FROM responses')).toBe(1);
    await post(`/admin/responses/${id}/featured`, { featured: false });
    expect(count(t.db, 'SELECT featured n FROM responses')).toBe(0);
  });
});

describe('GET /admin/report', () => {
  it('prints KPIs, strengths, pains and at most 10 anonymous quotes', async () => {
    seedDemo(t.db, t.config);
    const res = await get('/admin/report');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-mode="report"');
    expect(res.body).toContain('گزارش نظرسنجی رضایت مشتریان (NPS)');
    expect(res.body).toContain('۳ نقطه‌ی قوت');
    expect(res.body).toContain('۳ نقطه‌ی درد');
    const quotes = res.body.split('<section class="r-block r-quotes">')[1]!.split('</section>')[0]!;
    expect(quotes.match(/<li class="q-/g)).toHaveLength(10);
    // Quotes are anonymous: no customer names inside the quotes block.
    const names = t.db.prepare('SELECT name FROM customers WHERE name IS NOT NULL').all() as { name: string }[];
    expect(names.some((n) => quotes.includes(n.name))).toBe(false);
  });
});
