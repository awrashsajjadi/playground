import { defineConfig, devices } from '@playwright/test';

// Only Chromium is installed in CI/this environment, so the phone profiles emulate the devices on Chromium
// (viewport, DPR, touch, user agent). Remove `defaultBrowserType` to keep them off WebKit.
const { defaultBrowserType: _iphone, ...iphone12 } = devices['iPhone 12'];
const { defaultBrowserType: _android, ...android360 } = devices['Galaxy S8']; // 360 × 740

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 3,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'fa-IR',
    trace: 'off',
  },
  projects: [
    { name: 'iphone12', use: iphone12 },
    { name: 'android360', use: android360 },
    { name: 'desktop', use: { viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    command: 'node scripts/serve-test.ts',
    url: `http://127.0.0.1:${PORT}/healthz`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
