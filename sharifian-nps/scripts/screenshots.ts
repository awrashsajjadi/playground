// Captures the survey and admin screens with Playwright (Chromium) into docs/screenshots/.
// Also reports the form's transferred weight and checks that no external domain is requested.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { seedDemo } from '../src/services/demo.ts';
import { buildClient } from './build-client.ts';
import { startTestServer, TEST_PASSWORD, type RunningServer } from './test-server.ts';

const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));

const { defaultBrowserType: _a, ...iphone12 } = devices['iPhone 12'];
const { defaultBrowserType: _b, ...android360 } = devices['Galaxy S8']; // 360 × 740 CSS px

const DEVICES: Record<string, BrowserContextOptions> = {
  'iphone12': iphone12,
  'android360': android360,
};

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.waitForTimeout(350); // let the step animation finish
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  console.log(`  ✓ ${name}.png`);
}

async function surveyFlow(browser: Browser, server: RunningServer, device: string, options: BrowserContextOptions) {
  const context = await browser.newContext({ ...options, locale: 'fa-IR' });
  const page = await context.newPage();
  const external: string[] = [];
  let bytes = 0;
  page.on('request', (req) => {
    if (!req.url().startsWith(server.url)) external.push(req.url());
  });
  page.on('requestfinished', async (req) => {
    const sizes = await req.sizes().catch(() => null);
    if (sizes && !req.url().includes('/api/')) bytes += sizes.responseBodySize + sizes.responseHeadersSize;
  });

  await page.goto(`${server.url}/?src=sms&rep=r01`, { waitUntil: 'networkidle' });
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  await shot(page, `01-step1-${device}`);

  await page.click('label[for="score-7"]');
  await page.waitForSelector('.step[data-step="2"].is-active');
  await page.click('label[for="d-delivery"]');
  await page.click('label[for="d-price"]');
  await page.fill('#comment', 'ارسال گاهی دیر می‌رسد؛ اگر زمان تحویل دقیق‌تر باشد عالی است.');
  await shot(page, `02-step2-passive-${device}`);

  await page.click('[data-next]');
  await page.waitForSelector('.step[data-step="3"].is-active');
  await page.fill('#mobile', device === 'iphone12' ? '۰۹۱۲ ۱۲۳ ۴۵۶۷' : '0935-765-4321');
  await page.check('#consent input');
  await shot(page, `03-step3-${device}`);

  await page.waitForTimeout(3000); // the server rejects submissions faster than 3 seconds
  await page.click('[data-submit]');
  await page.waitForURL('**/thanks');
  await shot(page, `04-thanks-${device}`);

  console.log(`  form weight (${device}): ${(bytes / 1024).toFixed(1)} KB transferred · scrollWidth ${width[0]} / viewport ${width[1]} · external requests: ${external.length}`);
  await context.close();
  return { bytes, external, width };
}

async function dashboardShots(browser: Browser): Promise<void> {
  console.log('dashboard (demo data)');
  const server = await startTestServer({
    SURVEY_OPENS_AT: '2026-11-08T08:00:00+03:30',
    SURVEY_CLOSES_AT: '2026-11-14T23:59:59+03:30',
  });
  seedDemo(server.db, server.config, { now: server.config.closesAt.getTime() }); // whole window, reproducible
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fa-IR' });
  const page = await context.newPage();
  await page.goto(`${server.url}/admin/login`);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.fill('input[name="name"]', 'مدیر فروش');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin');
  await page.goto(`${server.url}/admin/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, '20-dashboard-desktop', true);
  await page.goto(`${server.url}/admin/report`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, '21-report-a4', true);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: join(OUT, '21-report-a4.pdf'), format: 'A4', printBackground: true });
  console.log('  ✓ 21-report-a4.pdf');
  await context.close();
  const mobile = await browser.newContext({ ...iphone12, locale: 'fa-IR' });
  const mp = await mobile.newPage();
  await mp.goto(`${server.url}/admin/login`);
  await mp.fill('input[name="password"]', TEST_PASSWORD);
  await mp.click('button[type="submit"]');
  await mp.waitForURL('**/admin');
  await mp.goto(`${server.url}/admin/dashboard`, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(600);
  await shot(mp, '22-dashboard-iphone12');
  await mobile.close();
  await server.close();
}

async function main(): Promise<void> {
  if (process.argv.includes('--dashboard-only')) {
    mkdirSync(OUT, { recursive: true });
    await buildClient();
    const browser = await chromium.launch();
    await dashboardShots(browser);
    await browser.close();
    return;
  }
  mkdirSync(OUT, { recursive: true });
  await buildClient();
  const server = await startTestServer();
  const browser = await chromium.launch();
  const report: string[] = [];
  try {
    for (const [name, options] of Object.entries(DEVICES)) {
      console.log(`survey on ${name}`);
      const r = await surveyFlow(browser, server, name, options);
      report.push(`${name}: ${(r.bytes / 1024).toFixed(1)} KB, scrollWidth=${r.width[0]} viewport=${r.width[1]}, external=${r.external.length}`);
    }

    // Detractor title + desktop single-row scale
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'fa-IR' });
    const dp = await desktop.newPage();
    await dp.goto(`${server.url}/?src=wa`, { waitUntil: 'networkidle' });
    await shot(dp, '05-step1-desktop');
    await dp.click('label[for="score-3"]');
    await dp.waitForSelector('.step[data-step="2"].is-active');
    await shot(dp, '06-step2-detractor-desktop');
    await desktop.close();

    // Without JavaScript: all steps on one page, classic POST
    const nojs = await browser.newContext({ ...android360, javaScriptEnabled: false });
    const np = await nojs.newPage();
    await np.goto(`${server.url}/`, { waitUntil: 'networkidle' });
    await shot(np, '07-no-javascript-android360', true);
    await nojs.close();

    // Not open yet
    const future = await startTestServer({
      SURVEY_OPENS_AT: '2026-11-08T08:00:00+03:30',
      SURVEY_CLOSES_AT: '2026-11-14T23:59:59+03:30',
    });
    const fctx = await browser.newContext(android360);
    const fp = await fctx.newPage();
    await fp.goto(`${future.url}/`, { waitUntil: 'networkidle' });
    await shot(fp, '08-not-open-android360');
    await fctx.close();
    await future.close();

    // Admin
    console.log('admin');
    const admin = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fa-IR' });
    const ap = await admin.newPage();
    await ap.goto(`${server.url}/admin`, { waitUntil: 'networkidle' });
    await shot(ap, '10-admin-login');
    await ap.fill('input[name="password"]', TEST_PASSWORD);
    await ap.fill('input[name="name"]', 'سارا (پشتیبانی)');
    await ap.click('button[type="submit"]');
    await ap.waitForURL('**/admin');

    const csv = join(tmpdir(), 'customers-demo.csv');
    writeFileSync(
      csv,
      '﻿mobile;name;company;city;province;customer_type;value_tier;sales_rep;first_purchase_date\r\n' +
        '09121234567;علی رضایی;عطاری رضایی;تهران;تهران;عطاری;A;r01;1401/05/12\r\n' +
        '09357654321;مریم احمدی;سوپرمارکت ستاره;مشهد;خراسان رضوی;سوپرمارکت;B;r02;1402/11/03\r\n' +
        '09131112233;حسین کریمی;رستوران شاندیز;اصفهان;اصفهان;رستوران;A;r01;1400/02/20\r\n' +
        '09171234000;زهرا موسوی;پخش نوین;شیراز;فارس;پخش‌کننده;C;r03;1403/07/15\r\n' +
        '0211234567;شماره ثابت;;;;;;;\r\n' +
        '09121234567;تکراری;;;;;;;\r\n',
    );
    await ap.goto(`${server.url}/admin/import`, { waitUntil: 'networkidle' });
    await ap.setInputFiles('#csv-file', csv);
    await ap.click('#csv-preview');
    await ap.waitForSelector('#import-result h2');
    await shot(ap, '11-admin-import-preview', true);
    await ap.click('#import-result button');
    await ap.waitForSelector('#import-result .banner-ok');

    await ap.goto(`${server.url}/admin`, { waitUntil: 'networkidle' });
    await shot(ap, '12-admin-home', true);
    await ap.goto(`${server.url}/admin/links`, { waitUntil: 'networkidle' });
    await ap.click('details:nth-of-type(2) summary').catch(() => undefined);
    await shot(ap, '13-admin-links', true);
    await admin.close();

    await dashboardShots(browser);
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`\nsummary\n  ${report.join('\n  ')}`);
}

await main();
