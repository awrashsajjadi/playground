// Admin panel: login, home, customer import, channel links, maintenance tools, backup.
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { surveyState } from '../config.ts';
import { ipHash, randomId, safeEqual } from '../core/crypto.ts';
import { faFullDateTime, shamsiStamp } from '../core/date.ts';
import { faDigits } from '../core/fa.ts';
import { faDuration } from '../core/labels.ts';
import { normalizeMobile } from '../core/mobile.ts';
import { computeNps } from '../core/nps.ts';
import type { AppContext } from '../context.ts';
import {
  cleanAdminName, createSessionValue, csrfToken, requireAdmin, sessionCookie,
} from '../plugins/auth.ts';
import { commitImport, previewImport, SAMPLE_CSV } from '../services/customers.ts';
import { issueTestLinkToken } from '../services/tokens.ts';

const FLASH: Record<string, (n: string) => string> = {
  deleted: (n) => `${faDigits(n)} پاسخ حذف شد. این شماره می‌تواند دوباره نظر بدهد.`,
  not_found: () => 'پاسخی با این شماره پیدا نشد.',
  bad_mobile: () => 'شماره موبایل معتبر نیست.',
  confirm: () => 'برای حذف، تیک «مطمئنم» را بزنید.',
  test_deleted: (n) => `${faDigits(n)} ثبت آزمایشی حذف شد.`,
  rematched: (n) => `مچ مجدد انجام شد؛ ${faDigits(n)} پاسخ به مشتری وصل است.`,
};

/** Only same-site admin paths are allowed as a post-login redirect. */
export function safeNext(value: unknown): string {
  return typeof value === 'string' && /^\/admin(\/|$|\?)/.test(value) && !value.startsWith('//') ? value : '/admin';
}

export function surveyLink(base: string, src: string, rep: string | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (src !== 'direct') params.set('src', src);
  if (rep) params.set('rep', rep);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return `${base}/${qs ? `?${qs}` : ''}`;
}

/** Renders an admin view with the shared layout data (session, CSRF token, nav, demo banner). */
export function makeAdminPage(ctx: AppContext) {
  const secret = ctx.config.sessionSecret;
  return (req: FastifyRequest, reply: FastifyReply, view: string, data: Record<string, unknown> = {}) => {
    const stats = ctx.repo.stats();
    return reply.header('cache-control', 'no-store').view(`admin/${view}`, {
      admin: req.admin,
      csrf: req.admin ? csrfToken(secret, req.admin) : '',
      nav: view,
      demo: stats.demo_customers + stats.demo > 0,
      ...data,
    });
  };
}

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, repo } = ctx;
  const secret = config.sessionSecret;
  const secure = config.env === 'production';
  const guard = requireAdmin(secret);
  const page = makeAdminPage(ctx);

  // ---------- login ----------
  app.get('/admin/login', async (req, reply) => {
    const next = safeNext((req.query as Record<string, unknown>).next);
    if (req.admin) return reply.redirect(next, 302);
    return page(req, reply, 'login', { next, error: null });
  });

  app.post('/admin/login', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const next = safeNext(body.next);
    const limit = ctx.loginLimiter.hit(ipHash(secret, req.ip), ctx.now().getTime());
    if (!limit.ok) {
      const minutes = faDigits(Math.ceil(limit.retryAfterSec / 60));
      reply.code(429).header('retry-after', String(limit.retryAfterSec));
      return page(req, reply, 'login', { next, error: `تلاش‌های زیادی انجام شد. ${minutes} دقیقه‌ی دیگر دوباره امتحان کنید.` });
    }
    if (typeof body.password !== 'string' || !safeEqual(body.password, config.adminPassword)) {
      reply.code(401);
      return page(req, reply, 'login', { next, error: 'رمز اشتباه است.' });
    }
    const value = createSessionValue(secret, cleanAdminName(body.name), ctx.now().getTime());
    return reply.header('set-cookie', sessionCookie(value, secure)).redirect(next, 303);
  });

  app.post('/admin/logout', { preHandler: guard }, async (_req, reply) =>
    reply.header('set-cookie', sessionCookie('', secure, 0)).redirect('/admin/login', 303));

  // ---------- home ----------
  app.get('/admin', { preHandler: guard }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const now = ctx.now();
    const stats = repo.stats();
    const state = surveyState(now, config);
    const countdown =
      state === 'not_open'
        ? `شروع تا ${faDuration(config.opensAt.getTime() - now.getTime(), faDigits)} دیگر`
        : state === 'open'
          ? `پایان تا ${faDuration(config.closesAt.getTime() - now.getTime(), faDigits)} دیگر`
          : 'نظرسنجی بسته شده است';
    const flash = q.msg && FLASH[q.msg] ? FLASH[q.msg]!(q.n ?? '0') : null;
    return page(req, reply, 'home', {
      stats,
      nps: computeNps(repo.scores()),
      state,
      countdown,
      opensAt: faFullDateTime(config.opensAt),
      closesAt: faFullDateTime(config.closesAt),
      responseRate: stats.customers > 0 ? stats.matched / stats.customers : null,
      flash,
      flashError: q.msg === 'not_found' || q.msg === 'bad_mobile' || q.msg === 'confirm',
      webhook: Boolean(config.webhookUrl),
    });
  });

  // ---------- customer import ----------
  app.get('/admin/import', { preHandler: guard }, async (req, reply) => page(req, reply, 'import'));

  app.get('/admin/import/sample.csv', { preHandler: guard }, async (_req, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="customers-sample.csv"')
      .send(`\uFEFF${SAMPLE_CSV}`));

  const upload = (handler: typeof previewImport | typeof commitImport) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return reply.code(400).send({ ok: false, error: 'no_file', message: 'فایلی دریافت نشد.' });
      }
      const result = handler(ctx, req.body);
      return reply.code(result.ok ? 200 : 400).send(result);
    };
  app.post('/admin/import/preview', { preHandler: guard, bodyLimit: 5 * 1024 * 1024 }, upload(previewImport));
  app.post('/admin/import/commit', { preHandler: guard, bodyLimit: 5 * 1024 * 1024 }, upload(commitImport));

  app.post('/admin/rematch', { preHandler: guard }, async (_req, reply) => {
    const result = repo.rematchAll();
    return reply.redirect(`/admin?msg=rematched&n=${result.matched}`, 303);
  });

  // ---------- channel links ----------
  app.get('/admin/links', { preHandler: guard }, async (req, reply) => {
    const base = config.publicBaseUrl;
    const channels = Object.entries(config.survey.channels);
    const reps = [...new Set([...Object.keys(config.survey.reps), ...repo.distinctReps()])];
    const linksFor = (rep: string | null) =>
      channels.map(([code, label]) => ({ code, label, url: surveyLink(base, code, rep) }));
    const testToken = issueTestLinkToken(secret, ctx.now().getTime());
    return page(req, reply, 'links', {
      groups: [
        { rep: null, title: 'لینک عمومی (بدون کارشناس)', links: linksFor(null) },
        ...reps.map((rep) => ({ rep, title: config.survey.reps[rep] ? `${config.survey.reps[rep]} (${rep})` : rep, links: linksFor(rep) })),
      ],
      testLinks: channels.map(([code, label]) => ({ code, label, url: surveyLink(base, code, null, { t: testToken }) })),
    });
  });

  // ---------- maintenance ----------
  app.post('/admin/responses/delete', { preHandler: guard }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.confirm !== 'yes') return reply.redirect('/admin?msg=confirm', 303);
    const mobile = normalizeMobile(body.mobile);
    if (!mobile) return reply.redirect('/admin?msg=bad_mobile', 303);
    const deleted = repo.deleteResponsesByMobile(mobile);
    if (deleted > 0) req.log.info({ deleted, by: req.admin?.name }, 'responses deleted by admin');
    return reply.redirect(deleted ? `/admin?msg=deleted&n=${deleted}` : '/admin?msg=not_found', 303);
  });

  app.post('/admin/test-data/delete', { preHandler: guard }, async (_req, reply) => {
    const deleted = repo.deleteTestResponses();
    return reply.redirect(`/admin?msg=test_deleted&n=${deleted}`, 303);
  });

  // Consistent snapshot via SQLite's online backup API (safe while the app is writing).
  app.get('/admin/backup', { preHandler: guard }, async (_req, reply) => {
    const file = join(tmpdir(), `nps-backup-${randomId(6)}.db`);
    await ctx.db.backup(file);
    const stream = createReadStream(file);
    stream.on('close', () => void rm(file, { force: true }));
    return reply
      .header('content-type', 'application/vnd.sqlite3')
      .header('content-disposition', `attachment; filename="sharifian-nps-backup-${shamsiStamp(ctx.now())}.db"`)
      .header('cache-control', 'no-store')
      .send(stream);
  });
}
