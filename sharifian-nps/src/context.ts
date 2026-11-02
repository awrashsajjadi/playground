import type { AppConfig } from './config.ts';
import type { RateLimiter } from './core/rate-limit.ts';
import type { CompiledTheme } from './core/themes.ts';
import type { DB } from './db/db.ts';
import type { Repo } from './db/repo.ts';
import type { Assets } from './plugins/assets.ts';
import type { Notifier } from './services/notify.ts';

/** Everything a route needs, built once in buildApp() and passed explicitly (easy to fake in tests). */
export interface AppContext {
  config: AppConfig;
  db: DB;
  repo: Repo;
  now: () => Date;
  themes: CompiledTheme[];
  submitLimiter: RateLimiter;
  loginLimiter: RateLimiter;
  notifier: Notifier;
  assets: Assets;
}
