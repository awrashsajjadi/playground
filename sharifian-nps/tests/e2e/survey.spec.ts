import { expect, test } from '@playwright/test';
import { BALE_URL, expectNoHorizontalScroll, pickScore, uniqueMobile, waitPastMinimumFillTime } from './helpers.ts';

const TITLES = {
  promoter: 'چه چیزی شریفیان را برای شما ارزشمند کرده؟',
  passive: 'چه چیزی باعث می‌شد به ما ۱۰ بدهید؟',
  detractor: 'بزرگ‌ترین مشکلی که با شریفیان داشتید چه بود؟',
};

const scenarios = [
  { name: 'promoter', score: 10, chips: ['quality', 'sales_team'], consent: false },
  { name: 'passive', score: 8, chips: ['price'], consent: true },
  { name: 'detractor', score: 3, chips: ['delivery', 'price'], consent: true },
] as const;

for (const s of scenarios) {
  test(`${s.name}: score ${s.score} → dynamic title, consent ${s.consent ? 'shown' : 'hidden'}, thanks page`, async ({ page }, info) => {
    const marker = `E2E-${info.project.name}-${s.name}-${Date.now()}`;
    await page.goto('/?src=wa&rep=r07');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.step[data-step="1"]')).toBeVisible();
    await expect(page.locator('.step[data-step="2"]')).toBeHidden();
    await expectNoHorizontalScroll(page);

    await pickScore(page, s.score);
    await expect(page.locator('#q2')).toHaveText(TITLES[s.name]);
    for (const chip of s.chips) await page.click(`label[for="d-${chip}"]`);
    await page.fill('#comment', `${marker} ارسال گاهی دیر می‌رسد`);
    await expectNoHorizontalScroll(page);
    await page.click('[data-next]');

    await expect(page.locator('#mobile')).toBeVisible();
    await expect(page.locator('#consent')).toBeVisible({ visible: s.consent });
    await page.fill('#mobile', uniqueMobile(info).replace(/^0/, '+98 '));
    if (s.consent) await page.check('#consent input');
    await expectNoHorizontalScroll(page);
    await waitPastMinimumFillTime(page);
    await page.click('[data-submit]');
    await page.waitForURL('**/thanks');
    await expect(page.locator('h1')).toContainText('ممنونیم');
    await expect(page.getByRole('link', { name: 'رفتن به فروشگاه شریفیان' })).toHaveAttribute('href', 'https://sharifianshop.com');
    await expectNoHorizontalScroll(page);

    // The instant Bale alert goes out for scores ≤ 6 only.
    await expect
      .poll(async () => {
        const received = (await (await fetch(`${BALE_URL}/received`)).json()) as { body: { chat_id: string; text: string } }[];
        return received.filter((r) => r.body.text.includes(marker)).length;
      })
      .toBe(s.score <= 6 ? 1 : 0);
    if (s.score <= 6) {
      const received = (await (await fetch(`${BALE_URL}/received`)).json()) as { path: string; body: { chat_id: string; text: string } }[];
      const alert = received.find((r) => r.body.text.includes(marker))!;
      expect(alert.path).toBe('/bot123:TEST/sendMessage');
      expect(alert.body.chat_id).toBe('4242');
      expect(alert.body.text).toContain(`امتیاز ${s.score === 3 ? '۳' : s.score} از ۱۰`);
      expect(alert.body.text).toContain('اجازه‌ی تماس: دارد');
    }
  });
}

test('the same mobile cannot answer twice', async ({ page }, info) => {
  const mobile = uniqueMobile(info);
  for (const expected of ['**/thanks', '**/already']) {
    await page.goto('/');
    await pickScore(page, 9);
    await page.click('[data-next]');
    await page.fill('#mobile', mobile);
    await waitPastMinimumFillTime(page);
    await page.click('[data-submit]');
    await page.waitForURL(expected);
  }
  await expect(page.locator('h1')).toHaveText('قبلاً ثبت شده');
});

test('back button, changing the score updates the title; the draft survives a reload', async ({ page }) => {
  await page.goto('/');
  await pickScore(page, 2);
  await expect(page.locator('#q2')).toHaveText(TITLES.detractor);
  await page.click('label[for="d-packaging"]');
  await page.fill('#comment', 'بسته‌بندی پاره بود');
  await page.click('.step[data-step="2"] [data-prev]');
  await expect(page.locator('.step[data-step="1"]')).toBeVisible();
  await pickScore(page, 9);
  await expect(page.locator('#q2')).toHaveText(TITLES.promoter);

  await page.reload();
  await expect(page.locator('.step[data-step="2"]')).toBeVisible();
  await expect(page.locator('#score-9')).toBeChecked();
  await expect(page.locator('#d-packaging')).toBeChecked();
  await expect(page.locator('#comment')).toHaveValue('بسته‌بندی پاره بود');
});

test('an invalid mobile number is caught before sending', async ({ page }) => {
  await page.goto('/');
  await pickScore(page, 7);
  await page.click('[data-next]');
  await page.fill('#mobile', '021 1234 5678');
  await page.click('[data-submit]');
  await expect(page.locator('#mobile-error')).toBeVisible();
  await expect(page.locator('#mobile')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/$/);
});

test('form page weight stays under 120 KB with zero external requests', async ({ page }) => {
  const external: string[] = [];
  let bytes = 0;
  page.on('request', (req) => {
    if (!req.url().startsWith('http://127.0.0.1:4173')) external.push(req.url());
  });
  page.on('requestfinished', async (req) => {
    const sizes = await req.sizes().catch(() => null);
    if (sizes && !req.url().includes('/api/')) bytes += sizes.responseBodySize + sizes.responseHeadersSize;
  });
  await page.goto('/?src=sms', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  expect(external).toEqual([]);
  expect(bytes, `${(bytes / 1024).toFixed(1)} KB transferred`).toBeLessThan(120 * 1024);
});

test.describe('desktop only', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard / no-JS checks run on the desktop project');

  test('keyboard: arrows choose a score without jumping, Enter moves on', async ({ page }) => {
    await page.goto('/');
    await page.focus('#score-0');
    await page.keyboard.press('ArrowDown'); // next radio in the group
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(400);
    await expect(page.locator('.step[data-step="1"]')).toBeVisible();
    await expect(page.locator('#score-2')).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(page.locator('#q2')).toBeFocused();
    await expect(page.locator('#q2')).toHaveText(TITLES.detractor);
  });

  test('submitting too fast shows a friendly message, then succeeds', async ({ page }, info) => {
    await page.goto('/');
    await pickScore(page, 10);
    await page.click('[data-next]');
    await page.fill('#mobile', uniqueMobile(info));
    await page.click('[data-submit]');
    await expect(page.locator('#form-error')).toHaveText('لطفاً چند ثانیه صبر کنید و دوباره «ثبت نظر» را بزنید.');
    await waitPastMinimumFillTime(page);
    await page.click('[data-submit]');
    await page.waitForURL('**/thanks');
  });

  test('works without JavaScript (single page, classic POST)', async ({ browser }, info) => {
    const context = await browser.newContext({ javaScriptEnabled: false, locale: 'fa-IR' });
    const page = await context.newPage();
    await page.goto('/?src=call');
    await expect(page.locator('.step[data-step="3"]')).toBeVisible();
    await page.click('label[for="score-6"]'); // native label activation, no JS involved
    await page.click('label[for="d-price"]');
    await expect(page.locator('#score-6')).toBeChecked();
    await page.fill('#mobile', uniqueMobile(info));
    await page.check('#consent input');
    await waitPastMinimumFillTime(page);
    await page.click('[data-submit]');
    await page.waitForURL('**/thanks');
    await context.close();
  });
});
