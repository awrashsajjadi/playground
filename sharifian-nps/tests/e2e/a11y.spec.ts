import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { pickScore, uniqueMobile, waitPastMinimumFillTime } from './helpers.ts';

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(
    blocking.map((v) => `${label}: [${v.impact}] ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    `${label}: no critical/serious axe violations`,
  ).toEqual([]);
  return results.violations;
}

test('the survey has no critical or serious accessibility violations (axe)', async ({ page }, info) => {
  // Audit the settled state: the 0.25 s step fade-in would otherwise be measured at partial opacity.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await audit(page, 'step 1');
  await pickScore(page, 5);
  await audit(page, 'step 2');
  await page.click('[data-next]');
  await audit(page, 'step 3');
  await page.fill('#mobile', uniqueMobile(info));
  await waitPastMinimumFillTime(page);
  await page.click('[data-submit]');
  await page.waitForURL('**/thanks');
  await audit(page, 'thanks');
});
