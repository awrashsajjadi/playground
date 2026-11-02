import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, count, createTestApp, getToken, login, submitJson, type TestApp } from '../helpers.ts';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
});

const BOM = '﻿';
const csvBytes = (s: string) => Buffer.from(s, 'utf8');

async function respond(mobile: string, score: number, extra: Record<string, unknown> = {}) {
  const tk = await getToken(t.app);
  t.advance(4000);
  const res = await submitJson(t.app, { tk, score, mobile, ...extra });
  expect(res.statusCode).toBe(201);
}

function upload(path: string, auth: { cookie: string; csrf: string }, body: Buffer) {
  return t.app.inject({
    method: 'POST',
    url: path,
    headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'content-type': 'application/octet-stream' },
    payload: body,
  });
}

describe('admin authentication', () => {
  it('pages without a session redirect to login; actions get 401', async () => {
    const page = await t.app.inject({ url: '/admin' });
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe('/admin/login?next=%2Fadmin');
    const csv = await t.app.inject({ url: '/admin/export/responses.csv' });
    expect(csv.statusCode).toBe(302);
    const action = await t.app.inject({ method: 'POST', url: '/admin/rematch' });
    expect(action.statusCode).toBe(401);
    const upload = await t.app.inject({
      method: 'POST', url: '/admin/import/preview', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x'),
    });
    expect(upload.statusCode).toBe(401);
  });

  it('wrong password → 401; right password → HttpOnly SameSite=Lax cookie (Secure only in production)', async () => {
    const bad = await t.app.inject({
      method: 'POST', url: '/admin/login', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'password=nope',
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.body).toContain('رمز اشتباه است.');

    const ok = await t.app.inject({
      method: 'POST', url: '/admin/login', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ password: PASSWORD, next: '/admin/links' }).toString(),
    });
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe('/admin/links');
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/^nps_admin=[^;]+; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
  });

  it('never redirects outside /admin after login', async () => {
    const res = await t.app.inject({
      method: 'POST', url: '/admin/login', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ password: PASSWORD, next: '//evil.example/admin' }).toString(),
    });
    expect(res.headers.location).toBe('/admin');
  });

  it('sets the Secure flag in production', async () => {
    const prod = await createTestApp({ env: { NODE_ENV: 'production' } });
    const res = await prod.app.inject({
      method: 'POST', url: '/admin/login', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ password: PASSWORD }).toString(),
    });
    expect(String(res.headers['set-cookie'])).toContain('; Secure');
    await prod.app.close();
  });

  it('rate-limits password guessing (10 per 15 minutes per IP)', async () => {
    const attempt = () =>
      t.app.inject({
        method: 'POST', url: '/admin/login', remoteAddress: '198.51.100.7',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'password=guess',
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
  });

  it('POST with a missing or wrong CSRF token → 403', async () => {
    const { cookie, csrf } = await login(t.app);
    const form = { 'content-type': 'application/x-www-form-urlencoded', cookie };
    expect((await t.app.inject({ method: 'POST', url: '/admin/rematch', headers: form, payload: '' })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/admin/rematch', headers: form, payload: '_csrf=wrong' })).statusCode).toBe(403);
    const ok = await t.app.inject({ method: 'POST', url: '/admin/rematch', headers: form, payload: `_csrf=${csrf}` });
    expect(ok.statusCode).toBe(303);
  });

  it('a session cookie from another secret is ignored; logout clears the cookie', async () => {
    const { cookie, csrf } = await login(t.app);
    const other = await createTestApp({ env: { SESSION_SECRET: 'z'.repeat(40) } });
    expect((await other.app.inject({ url: '/admin', headers: { cookie } })).statusCode).toBe(302);
    await other.app.close();

    const out = await t.app.inject({
      method: 'POST', url: '/admin/logout', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${csrf}`,
    });
    expect(out.statusCode).toBe(303);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('expired sessions are rejected', async () => {
    const { cookie } = await login(t.app);
    t.advance(7 * 24 * 3600_000 + 1);
    expect((await t.app.inject({ url: '/admin', headers: { cookie } })).statusCode).toBe(302);
  });
});

describe('admin home', () => {
  it('shows campaign status, counts and NPS so far', async () => {
    const auth = await login(t.app);
    await respond('09120000001', 10);
    await respond('09120000002', 3);
    const res = await t.app.inject({ url: '/admin', headers: { cookie: auth.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('نظرسنجی باز است');
    expect(res.body).toContain('پایان تا ۵ روز و ۱۴ ساعت دیگر'); // 5d 13h 59m 51s, rounded
    expect(res.body).toMatch(/پاسخ‌ها<\/span><strong class="kpi-value">۲</);
    expect(res.body).toContain('<strong class="kpi-value" dir="ltr">۰</strong>');
    expect(res.body).toMatch(/kpi-alert"><span class="kpi-label">منتقدان پیگیری‌نشده<\/span><strong class="kpi-value">۱</);
  });
});

describe('customer import', () => {
  const sample = [
    'mobile;name;company;city;province;customer_type;value_tier;sales_rep;first_purchase_date',
    '09121111111;علی رضایی;عطاری رضایی;تهران;تهران;عطاری;A;r01;1401/05/12',
    '۰۹۱۲۲۲۲۲۲۲۲;مریم;سوپر مریم;مشهد;خراسان رضوی;سوپرمارکت;b;r02;',
    '021555;ثابت;;;;;;;',
    '+98 912 111 1111;تکراری;;;;;;;',
    '09123333333;بدون مشخصات;;;;;Z;;',
  ].join('\r\n');

  it('preview: BOM, ; delimiter, error report, new/update counts — and writes nothing', async () => {
    const auth = await login(t.app);
    t.db.prepare("INSERT INTO customers (mobile, name, imported_at) VALUES ('09123333333', 'قدیمی', 'x')").run();
    const res = await upload('/admin/import/preview', auth, csvBytes(BOM + sample));
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data).toMatchObject({
      ok: true, totalRows: 5, validRows: 3, newCount: 2, updateCount: 1, errorCount: 2, warningCount: 1,
      encoding: 'UTF-8 (با BOM)', delimiter: 'نقطه‌ویرگول ;',
    });
    expect(data.errors.map((e: { message: string }) => e.message)).toEqual([
      'سطر ۴ — شماره موبایل نامعتبر است: 021555',
      'سطر ۵ — شماره در فایل تکراری است: 09121111111 (اولین بار در سطر ۲)',
    ]);
    expect(data.preview).toHaveLength(3);
    expect(data.preview[1]).toMatchObject({ mobile: '09122222222', value_tier: 'B', first_purchase_date: null });
    expect(count(t.db, 'SELECT COUNT(*) n FROM customers')).toBe(1);
  });

  it('commit: upserts by mobile without wiping existing values, then re-matches earlier responses', async () => {
    const auth = await login(t.app);
    await respond('09121111111', 2); // answered before the list was imported
    expect(count(t.db, 'SELECT COUNT(*) n FROM responses WHERE customer_id IS NULL')).toBe(1);
    t.db.prepare("INSERT INTO customers (mobile, name, city, imported_at) VALUES ('09123333333', 'قدیمی', 'کرج', 'x')").run();

    const res = await upload('/admin/import/commit', auth, csvBytes(BOM + sample));
    expect(res.json()).toEqual({ ok: true, inserted: 2, updated: 1, skipped: 2, matched: 1, unmatched: 0 });
    expect(t.db.prepare("SELECT name, city, value_tier FROM customers WHERE mobile = '09123333333'").get()).toEqual({
      name: 'بدون مشخصات', city: 'کرج', value_tier: null,
    });
    const linked = t.db.prepare('SELECT c.name, c.value_tier FROM responses r JOIN customers c ON c.id = r.customer_id').get();
    expect(linked).toEqual({ name: 'علی رضایی', value_tier: 'A' });
  });

  it('decodes Excel windows-1256 files', async () => {
    const auth = await login(t.app);
    const header = Buffer.from('mobile,city\n09121234567,', 'ascii');
    const mashhad = Buffer.from([0xe3, 0xd4, 0xe5, 0xcf]); // «مشهد» in windows-1256
    const res = await upload('/admin/import/preview', auth, Buffer.concat([header, mashhad, Buffer.from('\n')]));
    expect(res.json()).toMatchObject({ ok: true, encoding: 'Windows-1256 (CSV معمولی اکسل فارسی)' });
    expect(res.json().preview[0].city).toBe('مشهد');
  });

  it('reports a missing mobile column and empty uploads clearly', async () => {
    const auth = await login(t.app);
    const res = await upload('/admin/import/preview', auth, csvBytes('name,city\nعلی,تهران\n'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_mobile_column');
    const empty = await upload('/admin/import/preview', auth, Buffer.alloc(0));
    expect(empty.statusCode).toBe(400);
  });

  it('requires the CSRF header for uploads', async () => {
    const { cookie } = await login(t.app);
    const res = await upload('/admin/import/commit', { cookie, csrf: 'bad' }, csvBytes(sample));
    expect(res.statusCode).toBe(403);
    expect(count(t.db, 'SELECT COUNT(*) n FROM customers')).toBe(0);
  });
});

describe('exports', () => {
  async function seed() {
    const auth = await login(t.app);
    await upload(
      '/admin/import/commit',
      auth,
      csvBytes(
        'mobile,name,company,city,value_tier,sales_rep\n' +
          '09121111111,علی,عطاری علی,تهران,C,r01\n' +
          '09122222222,سارا,سوپر سارا,شیراز,A,r02\n' +
          '09123333333,نادر,,,B,\n',
      ),
    );
    await respond('09121111111', 1, { comment: '=HYPERLINK("x") قیمت گران', drivers: ['price'], contact: true });
    await respond('09122222222', 5, { comment: 'دیر رسید' });
    await respond('09129999999', 10); // not in the customer list
    return auth;
  }

  it('responses.csv: UTF-8 BOM, Persian headers, formula-safe text', async () => {
    const auth = await seed();
    const res = await t.app.inject({ url: '/admin/export/responses.csv', headers: { cookie: auth.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="sharifian-nps-responses-1405-08-18\.csv"$/);
    expect(res.body.startsWith('﻿')).toBe(true);
    const lines = res.body.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^شناسه,تاریخ و ساعت \(شمسی، تهران\),زمان UTC,موبایل,امتیاز,دسته,/);
    expect(lines[1]).toContain(`,09121111111,1,منتقد,قیمت,"'=HYPERLINK(""x"") قیمت گران",قیمت,بله,مستقیم,`);
    expect(lines[1]).toContain('1405/08/18 10:00');
  });

  it('non-respondents.csv lists customers without a response, with a personal SMS link', async () => {
    const auth = await seed();
    const res = await t.app.inject({ url: '/admin/export/non-respondents.csv', headers: { cookie: auth.cookie } });
    const lines = res.body.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('09123333333,نادر,,,,,B,,https://nazar.example.com/?src=sms,واقعی');
  });

  it('followups.csv lists detractors only, tier A first', async () => {
    const auth = await seed();
    const res = await t.app.inject({ url: '/admin/export/followups.csv', headers: { cookie: auth.cookie } });
    const lines = res.body.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',سارا,سوپر سارا,09122222222,5,');
    expect(lines[2]).toContain(',علی,عطاری علی,09121111111,1,قیمت,');
    expect(lines[1]).toMatch(/,خیر$/); // not overdue yet
    t.advance(49 * 3600_000);
    const later = await t.app.inject({ url: '/admin/export/followups.csv', headers: { cookie: auth.cookie } });
    expect(later.body.trim().split('\r\n')[1]).toMatch(/,بله$/);
  });
});

describe('links, maintenance and backup', () => {
  it('lists a link per channel for the general case and each sales rep', async () => {
    const auth = await login(t.app);
    t.db.prepare("INSERT INTO customers (mobile, sales_rep, imported_at) VALUES ('09121111111', 'r05', 'x')").run();
    const res = await t.app.inject({ url: '/admin/links', headers: { cookie: auth.cookie } });
    expect(res.body).toContain('value="https://nazar.example.com/"'); // direct, no params
    expect(res.body).toContain('value="https://nazar.example.com/?src=wa"');
    expect(res.body).toContain('value="https://nazar.example.com/?src=sms&amp;rep=r05"');
    expect(res.body).toContain('data-copy="https://nazar.example.com/?src=eitaa&amp;rep=r05"');
    expect(res.body).toContain('لینک‌های آزمایشی');
  });

  it('deletes a response by mobile (so the customer can answer again) only with confirmation', async () => {
    const auth = await login(t.app);
    await respond('09121234567', 0);
    const post = (payload: string) =>
      t.app.inject({
        method: 'POST', url: '/admin/responses/delete',
        headers: { cookie: auth.cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload,
      });
    expect((await post(`_csrf=${auth.csrf}&mobile=09121234567`)).headers.location).toBe('/admin?msg=confirm');
    const res = await post(`_csrf=${auth.csrf}&mobile=%2B989121234567&confirm=yes`);
    expect(res.headers.location).toBe('/admin?msg=deleted&n=1');
    expect(count(t.db, 'SELECT COUNT(*) n FROM responses')).toBe(0);
    await respond('09121234567', 9); // can answer again
  });

  it('deletes only test submissions with the test-data button', async () => {
    const auth = await login(t.app);
    await respond('09120000001', 9);
    // An admin session turns the form into test mode.
    const page = await t.app.inject({ url: '/', headers: { cookie: auth.cookie } });
    const tk = /name="tk" value="([^"]+)"/.exec(page.body)![1]!;
    t.advance(4000);
    expect((await submitJson(t.app, { tk, score: 1, mobile: '09120000001' })).statusCode).toBe(201);
    expect(count(t.db, "SELECT COUNT(*) n FROM responses WHERE kind = 'test'")).toBe(1);
    const res = await t.app.inject({
      method: 'POST', url: '/admin/test-data/delete',
      headers: { cookie: auth.cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: `_csrf=${auth.csrf}`,
    });
    expect(res.headers.location).toBe('/admin?msg=test_deleted&n=1');
    expect(t.db.prepare('SELECT kind, mobile FROM responses').all()).toEqual([{ kind: 'live', mobile: '09120000001' }]);
  });

  it('downloads a consistent SQLite backup', async () => {
    const auth = await login(t.app);
    await respond('09120000001', 9);
    const res = await t.app.inject({ url: '/admin/backup', headers: { cookie: auth.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/sharifian-nps-backup-1405-08-18\.db/);
    expect(res.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
  });
});
