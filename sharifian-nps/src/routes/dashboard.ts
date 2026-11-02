// Dashboard, printable executive report, and the two inline actions (follow-up status, featured quote).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { faDateTime } from '../core/date.ts';
import { FOLLOWUP_LABELS } from '../core/labels.ts';
import { normalizeFa } from '../core/themes.ts';
import type { AppContext } from '../context.ts';
import { csrfToken, requireAdmin } from '../plugins/auth.ts';
import { FOLLOWUP_STATUSES, loadDashboard } from '../services/dashboard.ts';
import { makeAdminPage } from './admin.ts';

const isJson = (req: FastifyRequest) => String(req.headers['content-type'] ?? '').startsWith('application/json');

/** Only our own dashboard query string may be echoed back into the redirect. */
function backTo(value: unknown, anchor: string): string {
  const qs = typeof value === 'string' && /^[\w=&%.+-]*$/.test(value) ? value : '';
  return `/admin/dashboard${qs ? `?${qs}` : ''}#${anchor}`;
}

export function dashboardRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, repo } = ctx;
  const guard = requireAdmin(config.sessionSecret);
  const page = makeAdminPage(ctx);

  app.get('/admin/dashboard', { preHandler: guard }, async (req, reply) => {
    const d = loadDashboard(ctx, req.query as Record<string, unknown>);
    return page(req, reply, 'dashboard', { title: 'داشبورد', d, search: normalizeFa });
  });

  app.get('/admin/report', { preHandler: guard }, async (req, reply) => {
    const d = loadDashboard(ctx, req.query as Record<string, unknown>);
    return reply
      .header('cache-control', 'no-store')
      .view('admin/report', { d, csrf: req.admin ? csrfToken(config.sessionSecret, req.admin) : '' });
  });

  const notFound = (req: FastifyRequest, reply: FastifyReply) =>
    isJson(req) ? reply.code(404).send({ ok: false, error: 'not_found' }) : reply.code(404).send('Not found');

  app.post('/admin/responses/:id/followup', { preHandler: guard }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = typeof body.status === 'string' ? body.status : '';
    if (!Number.isInteger(id) || !(FOLLOWUP_STATUSES as readonly string[]).includes(status)) {
      return reply.code(400).send({ ok: false, error: 'invalid' });
    }
    const note = typeof body.note === 'string' ? body.note.replace(/[\p{Cc}]/gu, ' ').trim().slice(0, 1000) || null : null;
    const by = req.admin?.name || 'ادمین';
    const at = ctx.now().toISOString();
    if (!repo.updateFollowup(id, status, note, by, at)) return notFound(req, reply);
    req.log.info({ id, status, by }, 'follow-up updated');
    if (!isJson(req)) return reply.redirect(backTo(body.back, `fu-${id}`), 303);
    return reply.send({ ok: true, status, statusLabel: FOLLOWUP_LABELS[status], note, by, at: faDateTime(at) });
  });

  app.post('/admin/responses/:id/featured', { preHandler: guard }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const featured = body.featured === true || body.featured === '1';
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'invalid' });
    if (!repo.setFeatured(id, featured)) return notFound(req, reply);
    if (!isJson(req)) return reply.redirect(backTo(body.back, `q-${id}`), 303);
    return reply.send({ ok: true, featured });
  });
}
