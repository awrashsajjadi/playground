// buildApp(): the whole HTTP app without listening — used by server.ts, tests (fastify.inject) and scripts.
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { RateLimiter } from './core/rate-limit.ts';
import { compileThemes, tagThemes } from './core/themes.ts';
import type { DB } from './db/db.ts';
import { createRepo } from './db/repo.ts';
import { loadAssets, setupAssets, type Assets } from './plugins/assets.ts';
import { setupAuth } from './plugins/auth.ts';
import { setupSecurity } from './plugins/security.ts';
import { setupViews } from './plugins/views.ts';
import { adminRoutes } from './routes/admin.ts';
import { dashboardRoutes } from './routes/dashboard.ts';
import { exportRoutes } from './routes/exports.ts';
import { surveyRoutes } from './routes/survey.ts';
import { createNotifier, type Notifier } from './services/notify.ts';

export const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

export interface BuildOptions {
  config: AppConfig;
  db: DB;
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
  notifier?: Notifier;
  assets?: Assets;
}

/** Production logger: no IPs, no query strings, no bodies (they contain mobile numbers). */
export function productionLogger(): FastifyServerOptions['logger'] {
  return {
    level: 'info',
    serializers: {
      req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
    },
  };
}

/** Re-applies themes.json to every stored comment (cheap for a few thousand rows). */
export function retagAll(ctx: Pick<AppContext, 'repo' | 'themes'>): number {
  let changed = 0;
  ctx.repo.transaction(() => {
    for (const row of ctx.repo.commentsForRetag()) {
      const tags = JSON.stringify(tagThemes(row.comment, ctx.themes));
      if (tags !== row.theme_tags) {
        ctx.repo.setThemeTags(row.id, tags);
        changed++;
      }
    }
  });
  return changed;
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const now = options.now ?? (() => new Date());

  const trust = config.trustProxy;
  const app = Fastify({
    logger: options.logger ?? false,
    // A number means "trust that many proxy hops" (same semantics as proxy-addr).
    trustProxy: typeof trust === 'number' ? (_address: string, hop: number) => hop < trust : trust,
    bodyLimit: 64 * 1024,
  });

  const ctx: AppContext = {
    config,
    db,
    repo: createRepo(db),
    now,
    themes: compileThemes(config.themes),
    submitLimiter: new RateLimiter(config.rateLimitPerHour, 3600_000),
    loginLimiter: new RateLimiter(10, 15 * 60_000),
    notifier:
      options.notifier ??
      createNotifier({ url: config.webhookUrl, adminUrl: `${config.publicBaseUrl}/admin`, log: app.log }),
    assets: options.assets ?? loadAssets(PUBLIC_DIR),
  };
  retagAll(ctx);

  // Classic HTML forms (no-JS survey, admin actions). Repeated keys become arrays; no prototype keys.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const out: Record<string, string | string[]> = Object.create(null);
    for (const [key, value] of new URLSearchParams(body as string)) {
      const prev = out[key];
      if (prev === undefined) out[key] = value;
      else if (Array.isArray(prev)) prev.push(value);
      else out[key] = [prev, value];
    }
    done(null, out);
  });
  // Raw uploads (customer CSV is sent as bytes and decoded on the server).
  app.addContentTypeParser(['application/octet-stream', 'text/csv'], { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => {
    done(null, body);
  });

  setupSecurity(app, { production: config.env === 'production' });
  setupAssets(app, ctx.assets);
  setupViews(app, ctx);
  setupAuth(app, { secret: config.sessionSecret, now });

  surveyRoutes(app, ctx);
  adminRoutes(app, ctx);
  dashboardRoutes(app, ctx);
  exportRoutes(app, ctx);

  const wantsJson = (url: string, accept: string | undefined) =>
    url.startsWith('/api/') || (!!accept && accept.includes('application/json') && !accept.includes('text/html'));

  app.setNotFoundHandler((req, reply) => {
    if (wantsJson(req.url, req.headers.accept)) return reply.code(404).send({ ok: false, error: 'not_found' });
    return reply.code(404).view('message', { title: '۴۰۴', text: config.survey.states.notFound, emoji: '🔍' });
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    if (wantsJson(req.url, req.headers.accept) || req.url.startsWith('/admin/')) {
      return reply.code(status).send({ ok: false, error: status >= 500 ? 'server_error' : 'bad_request' });
    }
    return reply
      .code(status)
      .view('message', { title: config.survey.states.errorTitle, text: config.survey.states.error, emoji: '😕' });
  });

  return app;
}
