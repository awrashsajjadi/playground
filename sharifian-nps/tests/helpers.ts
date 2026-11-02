import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig, type AppConfig } from '../src/config.ts';
import { openDb, type DB } from '../src/db/db.ts';
import type { DetractorAlert, Notifier } from '../src/services/notify.ts';

export const SECRET = 's'.repeat(40);
export const PASSWORD = 'correct horse battery';
export const OPENS = '2026-11-08T08:00:00+03:30';
export const CLOSES = '2026-11-14T23:59:59+03:30';
/** Inside the campaign window. */
export const DURING = '2026-11-09T10:00:00+03:30';

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    ADMIN_PASSWORD: PASSWORD,
    SESSION_SECRET: SECRET,
    SURVEY_OPENS_AT: OPENS,
    SURVEY_CLOSES_AT: CLOSES,
    PUBLIC_BASE_URL: 'https://nazar.example.com',
    DATABASE_PATH: ':memory:',
    ...env,
  });
}

export interface TestApp {
  app: FastifyInstance;
  db: DB;
  config: AppConfig;
  alerts: DetractorAlert[];
  /** Moves the fake clock forward. */
  advance(ms: number): void;
  setNow(iso: string): void;
}

export async function createTestApp(options: { now?: string; env?: Record<string, string> } = {}): Promise<TestApp> {
  let now = new Date(options.now ?? DURING).getTime();
  const alerts: DetractorAlert[] = [];
  const notifier: Notifier = { detractor: (a) => alerts.push(a) };
  const config = testConfig(options.env);
  const db = openDb(':memory:');
  const app = await buildApp({ config, db, now: () => new Date(now), notifier });
  return {
    app,
    db,
    config,
    alerts,
    advance(ms) {
      now += ms;
    },
    setNow(iso) {
      now = new Date(iso).getTime();
    },
  };
}

/** Renders the form and returns its signed token (tk). */
export async function getToken(app: FastifyInstance, query = ''): Promise<string> {
  const res = await app.inject({ method: 'GET', url: `/${query}` });
  const match = /name="tk" value="([^"]+)"/.exec(res.body);
  if (!match?.[1]) throw new Error(`no form token in page (status ${res.statusCode})`);
  return match[1];
}

let ipCounter = 0;
/** A fresh client IP per call so the per-IP rate limit does not interfere unless a test wants it. */
export function nextIp(): string {
  ipCounter++;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

export function submitJson(
  app: FastifyInstance,
  body: Record<string, unknown>,
  ip = nextIp(),
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/submit',
    remoteAddress: ip,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    payload: JSON.stringify(body),
  });
}

export function submitForm(app: FastifyInstance, fields: [string, string][], ip = nextIp()) {
  return app.inject({
    method: 'POST',
    url: '/api/submit',
    remoteAddress: ip,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
}

/** Logs in and returns the cookie header + CSRF token for admin requests. */
export async function login(app: FastifyInstance, name = 'تست'): Promise<{ cookie: string; csrf: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/login',
    remoteAddress: nextIp(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ password: PASSWORD, name }).toString(),
  });
  const setCookie = String(res.headers['set-cookie'] ?? '');
  const cookie = setCookie.split(';')[0] ?? '';
  if (res.statusCode !== 303 || !cookie) throw new Error(`login failed: ${res.statusCode}`);
  const home = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
  const csrf = /name="csrf-token" content="([^"]+)"/.exec(home.body)?.[1];
  if (!csrf) throw new Error('no csrf token on admin home');
  return { cookie, csrf };
}

export function count(db: DB, sql: string, ...params: unknown[]): number {
  return Number((db.prepare(sql).get(...params) as { n: number }).n);
}
