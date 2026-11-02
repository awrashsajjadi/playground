// Starts a real HTTP server on a random port with a throwaway database (screenshots, E2E, load tests).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import { loadConfig, type AppConfig } from '../src/config.ts';
import { openDb, type DB } from '../src/db/db.ts';

export const TEST_PASSWORD = 'screenshot-password-123';

export interface RunningServer {
  url: string;
  db: DB;
  config: AppConfig;
  close(): Promise<void>;
}

export async function startTestServer(env: Record<string, string> = {}, port = 0): Promise<RunningServer> {
  const dir = mkdtempSync(join(tmpdir(), 'nps-'));
  const now = Date.now();
  const config = loadConfig({
    NODE_ENV: 'test',
    ADMIN_PASSWORD: TEST_PASSWORD,
    SESSION_SECRET: 'x'.repeat(48),
    SURVEY_OPENS_AT: new Date(now - 24 * 3600_000).toISOString(),
    SURVEY_CLOSES_AT: new Date(now + 6 * 24 * 3600_000).toISOString(),
    DATABASE_PATH: join(dir, 'nps.db'),
    PUBLIC_BASE_URL: 'https://nazar.sharifianshop.com',
    ...env,
  });
  const db = openDb(config.databasePath);
  const app = await buildApp({ config, db });
  const address = await app.listen({ port, host: '127.0.0.1' });
  return {
    url: address,
    db,
    config,
    async close() {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
