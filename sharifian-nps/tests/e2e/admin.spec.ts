import { expect, test } from '@playwright/test';
import { loginAdmin, pickScore, uniqueMobile, waitPastMinimumFillTime } from './helpers.ts';

test.skip(({ isMobile }) => isMobile, 'admin flows run on the desktop project');

test('a new response shows up on the dashboard and its follow-up status can be changed', async ({ page, browser }, info) => {
  // The customer answers in a separate browser context (an admin session would switch the form to test mode).
  const marker = `پیگیری-E2E-${Date.now()}`;
  const mobile = uniqueMobile(info);
  const customer = await browser.newContext({ locale: 'fa-IR' });
  const form = await customer.newPage();
  await form.goto('/?src=bale');
  await pickScore(form, 1);
  await form.fill('#comment', `${marker} جنس خراب رسید`);
  await form.click('[data-next]');
  await form.fill('#mobile', mobile);
  await form.check('#consent input');
  await waitPastMinimumFillTime(form);
  await form.click('[data-submit]');
  await form.waitForURL('**/thanks');
  await customer.close();

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await loginAdmin(page);
  await page.goto('/admin/dashboard');
  await expect(page.locator('#comments .quote-text', { hasText: marker })).toBeVisible();
  await expect(page.locator('canvas#ch-hist')).toBeVisible();

  const row = page.locator('#followups tr', { has: page.locator(`a[href="tel:${mobile}"]`) });
  await expect(row).toBeVisible();
  await expect(row.locator('select[name="status"]')).toHaveValue('todo');
  await row.locator('input[name="note"]').fill('با مشتری تماس گرفته شد');
  await row.locator('button[type="submit"]').click();
  await expect(row.locator('[data-meta]')).toContainText('ذخیره شد');
  await row.locator('select[name="status"]').selectOption('called'); // saves on change
  await expect(row.locator('[data-meta]')).toContainText('تست E2E');

  await page.reload();
  const again = page.locator('#followups tr', { has: page.locator(`a[href="tel:${mobile}"]`) });
  await expect(again.locator('select[name="status"]')).toHaveValue('called');
  await expect(again.locator('input[name="note"]')).toHaveValue('با مشتری تماس گرفته شد');

  // Comment wall search narrows to the new comment.
  await page.fill('#wall-search', marker);
  await expect(page.locator('#comments .quote:visible')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the printable report renders its charts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await loginAdmin(page);
  await page.goto('/admin/report');
  await expect(page.locator('h1')).toHaveText('گزارش نظرسنجی رضایت مشتریان (NPS)');
  for (const id of ['ch-hist', 'ch-nps', 'ch-daily', 'ch-drivers', 'ch-themes']) {
    await expect(page.locator(`canvas#${id}`)).toBeVisible();
  }
  expect(errors).toEqual([]);
});
