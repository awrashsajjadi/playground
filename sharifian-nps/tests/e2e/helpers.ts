import { expect, type Page, type TestInfo } from '@playwright/test';

export const ADMIN_PASSWORD = 'screenshot-password-123';
export const BALE_URL = 'http://127.0.0.1:4174';

let counter = 0;
/** Unique mobile per test run + project + call (the server allows one response per mobile). */
export function uniqueMobile(info: TestInfo): string {
  counter++;
  const project = ['iphone12', 'android360', 'desktop'].indexOf(info.project.name) + 1;
  const stamp = (Date.now() % 100_000).toString().padStart(5, '0');
  return `0912${project}${stamp}${String(counter % 10)}`;
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollWidth, 'page must not scroll horizontally').toBeLessThanOrEqual(innerWidth);
}

/** The server rejects submissions within 3 s of rendering the form (anti-spam), so real-speed tests wait. */
export async function waitPastMinimumFillTime(page: Page): Promise<void> {
  await page.waitForTimeout(3100);
}

export async function pickScore(page: Page, score: number): Promise<void> {
  await page.click(`label[for="score-${score}"]`);
  await expect(page.locator('.step[data-step="2"]')).toBeVisible();
}

export async function loginAdmin(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.fill('input[name="name"]', 'تست E2E');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin');
}
