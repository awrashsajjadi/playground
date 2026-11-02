import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSES, OPENS, count, createTestApp, getToken, login, submitForm, submitJson, type TestApp } from '../helpers.ts';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
});

/** Renders the form, waits past the 3-second minimum, returns a valid submission body. */
async function validBody(overrides: Record<string, unknown> = {}, query = '') {
  const tk = await getToken(t.app, query);
  t.advance(5_000);
  return { tk, score: 9, drivers: ['quality', 'price'], comment: 'ادویه‌ها تازه بود', mobile: '0912 123 4567', ...overrides };
}

describe('GET /', () => {
  it('renders the RTL form with 11 score buttons, a token and channel tracking', async () => {
    const res = await t.app.inject({ url: '/?src=wa&rep=r07' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('<html lang="fa" dir="rtl">');
    expect(res.body.match(/type="radio" name="score"/g)).toHaveLength(11);
    expect(res.body).toContain('name="src" value="wa"');
    expect(res.body).toContain('name="rep" value="r07"');
    expect(res.body).toMatch(/name="tk" value="[^"]+"/);
  });

  it('falls back to src=direct for unknown channels and strips unsafe rep codes', async () => {
    const res = await t.app.inject({ url: '/?src=evil&rep=%3Cscript%3Ex' });
    expect(res.body).toContain('name="src" value="direct"');
    expect(res.body).toContain('name="rep" value="scriptx"');
  });

  it('shows the "starts at" page before opening and the closed page after closing', async () => {
    t.setNow('2026-11-07T12:00:00+03:30');
    const before = await t.app.inject({ url: '/' });
    expect(before.statusCode).toBe(200);
    expect(before.body).toContain('نظرسنجی از یکشنبه ۱۷ آبان ۱۴۰۵، ساعت ۸:۰۰ شروع می‌شود.');
    expect(before.body).not.toContain('name="tk"');

    t.setNow('2026-11-15T00:00:00+03:30');
    const after = await t.app.inject({ url: '/' });
    expect(after.body).toContain('نظرسنجی بسته شده است. از همراهی‌تان ممنونیم.');
  });

  it('sends security headers and a CSP that only allows our own scripts', async () => {
    const res = await t.app.inject({ url: '/' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toMatch(/script-src 'self' 'sha256-[^']+'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('gzips HTML when the browser accepts it', async () => {
    const res = await t.app.inject({ url: '/', headers: { 'accept-encoding': 'gzip, br' } });
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});

describe('POST /api/submit (JSON)', () => {
  it('201 on success; stores category, drivers, themes, channel and matches the customer', async () => {
    t.db
      .prepare("INSERT INTO customers (mobile, name, company, imported_at) VALUES ('09121234567', 'علی', 'عطاری علی', 'x')")
      .run();
    const res = await submitJson(t.app, await validBody({ src: 'sms', rep: 'r01', contact: true }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, category: 'promoter' });

    const row = t.db.prepare('SELECT * FROM responses').get() as Record<string, unknown>;
    expect(row).toMatchObject({
      mobile: '09121234567',
      score: 9,
      category: 'promoter',
      drivers: '["quality","price"]',
      comment: 'ادویه‌ها تازه بود',
      contact_ok: 0, // consent is only stored for scores ≤ 8
      src: 'sms',
      rep: 'r01',
      followup_status: 'none',
      theme_tags: '["quality"]',
      kind: 'live',
    });
    expect(row.customer_id).toBe(1);
    expect(row.duration_ms).toBe(5000);
    expect(String(row.ip_hash)).toHaveLength(16);
    expect(count(t.db, "SELECT COUNT(*) n FROM events WHERE type = 'submitted' AND src = 'sms'")).toBe(1);
  });

  it.each([
    [0, 'detractor', 'todo'],
    [6, 'detractor', 'todo'],
    [7, 'passive', 'none'],
    [8, 'passive', 'none'],
    [10, 'promoter', 'none'],
  ])('score %i → %s (follow-up %s)', async (score, category, followup) => {
    const res = await submitJson(t.app, await validBody({ score }));
    expect(res.statusCode).toBe(201);
    const row = t.db.prepare('SELECT category, followup_status, customer_id FROM responses').get();
    expect(row).toEqual({ category, followup_status: followup, customer_id: null });
  });

  it('stores contact consent for passives and detractors', async () => {
    await submitJson(t.app, await validBody({ score: 4, contact: true }));
    expect(count(t.db, 'SELECT contact_ok n FROM responses')).toBe(1);
  });

  it('duplicate mobile → 409, no second response, attempt logged', async () => {
    expect((await submitJson(t.app, await validBody({ mobile: '09121234567' }))).statusCode).toBe(201);
    const dup = await submitJson(t.app, await validBody({ mobile: '+98 912 123 4567', score: 2 }));
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: 'duplicate', message: 'شما قبلاً نظرتان را ثبت کرده‌اید. ممنونیم!' });
    expect(count(t.db, 'SELECT COUNT(*) n FROM responses')).toBe(1);
    expect(t.db.prepare('SELECT mobile, score FROM duplicate_attempts').all()).toEqual([{ mobile: '09121234567', score: 2 }]);
  });

  it('rejects before opening and after closing (403)', async () => {
    const body = await validBody();
    t.setNow('2026-11-08T07:59:59+03:30');
    const early = await submitJson(t.app, body);
    expect(early.statusCode).toBe(403);
    expect(early.json().error).toBe('not_open');

    t.setNow('2026-11-15T00:00:00+03:30');
    const late = await submitJson(t.app, body);
    expect(late.statusCode).toBe(403);
    expect(late.json().error).toBe('closed');
    expect(count(t.db, 'SELECT COUNT(*) n FROM responses')).toBe(0);
  });

  it('accepts at the opening instant and at the closing instant (inclusive)', async () => {
    t.setNow(OPENS);
    const tk = await getToken(t.app);
    t.advance(3000);
    expect((await submitJson(t.app, { tk, score: 5, mobile: '09120000001' })).statusCode).toBe(201);

    t.setNow(new Date(new Date(CLOSES).getTime() - 10_000).toISOString());
    const tk2 = await getToken(t.app);
    t.setNow(CLOSES);
    expect((await submitJson(t.app, { tk: tk2, score: 5, mobile: '09120000002' })).statusCode).toBe(201);
    t.advance(1);
    expect((await submitJson(t.app, { tk: tk2, score: 5, mobile: '09120000003' })).statusCode).toBe(403);
  });

  it('honeypot filled → rejected, nothing stored', async () => {
    const res = await submitJson(t.app, await validBody({ website: 'http://spam.example' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('rejected');
    expect(count(t.db, 'SELECT COUNT(*) n FROM responses')).toBe(0);
  });

  it('faster than 3 seconds → rejected', async () => {
    const tk = await getToken(t.app);
    t.advance(2_999);
    const res = await submitJson(t.app, { tk, score: 9, mobile: '09121234567' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('too_fast');
    t.advance(1);
    expect((await submitJson(t.app, { tk, score: 9, mobile: '09121234567' })).statusCode).toBe(201);
  });

  it('missing or forged token → rejected', async () => {
    const res1 = await submitJson(t.app, { score: 9, mobile: '09121234567' });
    expect(res1.json().error).toBe('bad_token');
    const tk = await getToken(t.app);
    t.advance(5000);
    const forged = tk.replace(/\.l\./, '.t.');
    expect((await submitJson(t.app, { tk: forged, score: 9, mobile: '09121234567' })).json().error).toBe('bad_token');
  });

  it('rate limit: the 11th submission from one IP within an hour → 429', async () => {
    const ip = '203.0.113.9';
    for (let i = 0; i < 10; i++) {
      const res = await submitJson(t.app, await validBody({ mobile: `0912000000${i}` }), ip);
      expect(res.statusCode).toBe(201);
    }
    const blocked = await submitJson(t.app, await validBody({ mobile: '09120000099' }), ip);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await submitJson(t.app, await validBody({ mobile: '09120000098' }), '203.0.113.10')).statusCode).toBe(201);
    t.advance(3600_000);
    expect((await submitJson(t.app, await validBody({ mobile: '09120000097' }), ip)).statusCode).toBe(201);
  });

  it.each([[11], [-1], ['abc'], ['7'], [7.5], [null]])('invalid score %s → 400', async (score) => {
    const res = await submitJson(t.app, await validBody({ score }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid', fields: { score: 'score_invalid' } });
  });

  it('invalid mobile → 400 with a field error', async () => {
    const res = await submitJson(t.app, await validBody({ mobile: '02112345678' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual({ mobile: 'mobile_invalid' });
  });

  it('comment over 1000 characters → 400; unknown drivers are ignored', async () => {
    const long = await submitJson(t.app, await validBody({ comment: 'ب'.repeat(1001) }));
    expect(long.json().fields).toEqual({ comment: 'comment_too_long' });
    const ok = await submitJson(t.app, await validBody({ drivers: ['price', 'hacker', 'price', 'quality'] }));
    expect(ok.statusCode).toBe(201);
    expect(t.db.prepare('SELECT drivers FROM responses').get()).toEqual({ drivers: '["quality","price"]' });
  });

  it('sends an instant alert for scores ≤ 6 only', async () => {
    t.db.prepare("INSERT INTO customers (mobile, name, company, imported_at) VALUES ('09121111111', 'رضا', 'پخش رضا', 'x')").run();
    await submitJson(t.app, await validBody({ score: 3, mobile: '09121111111', drivers: ['delivery'], comment: 'دیر رسید', contact: true }));
    await submitJson(t.app, await validBody({ score: 7, mobile: '09122222222' }));
    expect(t.alerts).toEqual([
      {
        score: 3, name: 'رضا', company: 'پخش رضا', comment: 'دیر رسید', drivers: ['ارسال و تحویل به‌موقع'],
        contactOk: true, channel: 'مستقیم', test: false,
      },
    ]);
  });
});

describe('POST /api/submit (classic form, no JavaScript)', () => {
  const fields = async (extra: [string, string][]) => {
    const tk = await getToken(t.app);
    t.advance(4000);
    return [['tk', tk], ['src', 'call'], ...extra] as [string, string][];
  };

  it('success → 303 to /thanks (Post/Redirect/Get); string scores are fine here', async () => {
    const res = await submitForm(t.app, await fields([['score', '8'], ['drivers', 'price'], ['drivers', 'variety'], ['mobile', '۰۹۱۲۱۲۳۴۵۶۷'], ['contact', '1']]));
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/thanks');
    expect(t.db.prepare('SELECT score, drivers, contact_ok, src FROM responses').get()).toEqual({
      score: 8, drivers: '["price","variety"]', contact_ok: 1, src: 'call',
    });
  });

  it('duplicate → 303 to /already', async () => {
    await submitForm(t.app, await fields([['score', '9'], ['mobile', '09121234567']]));
    const res = await submitForm(t.app, await fields([['score', '1'], ['mobile', '09121234567']]));
    expect(res.headers.location).toBe('/already');
  });

  it('invalid input → 400 with the form re-rendered, values kept and the error shown', async () => {
    const res = await submitForm(t.app, await fields([['score', '5'], ['comment', 'سلام'], ['mobile', '123']]));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('id="score-5" value="5" checked');
    expect(res.body).toContain('>سلام</textarea>');
    expect(res.body).toContain('aria-invalid="true"');
    expect(res.body).toMatch(/<p class="field-error" id="mobile-error" role="alert">/);
  });
});

describe('POST /api/events (funnel)', () => {
  const send = (payload: string) =>
    t.app.inject({ method: 'POST', url: '/api/events', headers: { 'content-type': 'text/plain;charset=UTF-8' }, payload });

  it('stores each (session, step) once, with the channel', async () => {
    const tk = await getToken(t.app, '?src=bale');
    expect((await send(JSON.stringify({ tk, type: 'view', src: 'bale' }))).statusCode).toBe(204);
    await send(JSON.stringify({ tk, type: 'view', src: 'bale' }));
    await send(JSON.stringify({ tk, type: 'score_selected', src: 'bale' }));
    expect(t.db.prepare('SELECT type, src FROM events ORDER BY id').all()).toEqual([
      { type: 'view', src: 'bale' },
      { type: 'score_selected', src: 'bale' },
    ]);
  });

  it('rejects unknown types, forged tokens and client-sent "submitted"', async () => {
    const tk = await getToken(t.app);
    expect((await send(JSON.stringify({ tk, type: 'submitted' }))).statusCode).toBe(400);
    expect((await send(JSON.stringify({ tk: 'x.y.z', type: 'view' }))).statusCode).toBe(400);
    expect((await send('not json')).statusCode).toBe(400);
    expect(count(t.db, 'SELECT COUNT(*) n FROM events')).toBe(0);
  });
});

describe('test mode (day-before checklist)', () => {
  it('a signed test link opens the form before the campaign; saved as kind=test, no funnel events', async () => {
    t.setNow('2026-11-07T10:00:00+03:30');
    const { cookie } = await login(t.app);
    const links = await t.app.inject({ url: '/admin/links', headers: { cookie } });
    const testUrl = /value="https:\/\/nazar\.example\.com\/(\?src=sms&amp;t=[^"]+)"/.exec(links.body)?.[1]?.replace(/&amp;/g, '&');
    expect(testUrl).toBeTruthy();

    const page = await t.app.inject({ url: `/${testUrl}` });
    expect(page.body).toContain('حالت آزمایشی');
    const tk = /name="tk" value="([^"]+)"/.exec(page.body)![1]!;
    t.advance(5000);
    await t.app.inject({ method: 'POST', url: '/api/events', payload: JSON.stringify({ tk, type: 'view' }), headers: { 'content-type': 'text/plain' } });
    const res = await submitJson(t.app, { tk, score: 2, mobile: '09121234567', src: 'sms' });
    expect(res.statusCode).toBe(201);
    // Same mobile again is fine in test mode.
    expect((await submitJson(t.app, { tk, score: 3, mobile: '09121234567' })).statusCode).toBe(201);
    expect(t.db.prepare('SELECT kind, COUNT(*) n FROM responses GROUP BY kind').all()).toEqual([{ kind: 'test', n: 2 }]);
    expect(count(t.db, 'SELECT COUNT(*) n FROM events')).toBe(0);
    expect(t.alerts.every((a) => a.test)).toBe(true);
  });

  it('an expired or forged test link does not unlock the form', async () => {
    t.setNow('2026-11-07T10:00:00+03:30');
    const res = await t.app.inject({ url: '/?t=abc.def' });
    expect(res.body).not.toContain('name="tk"');
  });
});

describe('other public pages', () => {
  it('thanks / already / robots / healthz / 404', async () => {
    const thanks = await t.app.inject({ url: '/thanks' });
    expect(thanks.body).toContain('ممنونیم 🙏');
    expect(thanks.body).toContain('href="https://sharifianshop.com"');
    expect((await t.app.inject({ url: '/already' })).body).toContain('شما قبلاً نظرتان را ثبت کرده‌اید');
    expect((await t.app.inject({ url: '/robots.txt' })).body).toContain('Disallow: /');
    expect((await t.app.inject({ url: '/healthz' })).json()).toEqual({ ok: true });
    expect((await t.app.inject({ url: '/nope' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/api/nope' })).json()).toEqual({ ok: false, error: 'not_found' });
  });

  it('serves hashed assets with immutable caching and gzip', async () => {
    const page = await t.app.inject({ url: '/' });
    const css = /href="(\/assets\/css\/form\.[0-9a-f]{10}\.css)"/.exec(page.body)?.[1];
    expect(css).toBeTruthy();
    const res = await t.app.inject({ url: css!, headers: { 'accept-encoding': 'gzip' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect((await t.app.inject({ url: '/assets/css/form.0000000000.css' })).statusCode).toBe(404);
  });
});
