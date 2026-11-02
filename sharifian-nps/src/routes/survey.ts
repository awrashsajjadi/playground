// Public routes: the 3-step form, submission API, funnel events and result pages.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { surveyState, type DriverDef } from '../config.ts';
import { faFullDateTime } from '../core/date.ts';
import type { AppContext } from '../context.ts';
import {
  cleanRep, pickChannel, submitResponse, type FieldErrors, type FormValues, type SubmitOutcome,
} from '../services/submit.ts';
import { isValidTestLink, issueFormToken, readFormToken } from '../services/tokens.ts';

interface FormRender {
  src: string;
  rep: string | null;
  test: boolean;
  values?: FormValues;
  errors?: FieldErrors;
  formError?: string;
  status?: number;
}

function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function surveyRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config } = ctx;
  const survey = config.survey;
  const secret = config.sessionSecret;
  const healthCheck = ctx.db.prepare('SELECT 1');

  const message = (reply: FastifyReply, status: number, data: Record<string, unknown>) =>
    reply.code(status).header('cache-control', 'no-store').view('message', data);

  const stateMessage = (reply: FastifyReply, state: 'not_open' | 'closed', status = 200) =>
    state === 'not_open'
      ? message(reply, status, {
          title: survey.states.notOpenTitle,
          text: survey.states.notOpen.replace('{date}', faFullDateTime(config.opensAt)),
          emoji: '⏳',
        })
      : message(reply, status, { title: survey.states.closedTitle, text: survey.states.closed, emoji: '🙏', shop: true });

  const errorMessage = (reply: FastifyReply, status: number, text = survey.states.error) =>
    message(reply, status, { title: survey.states.errorTitle, text, emoji: '😕' });

  const renderForm = (reply: FastifyReply, form: FormRender) => {
    const errors = form.errors ?? {};
    const startStep = errors.score ? 1 : errors.comment ? 2 : errors.mobile || form.formError ? 3 : 1;
    const drivers: DriverDef[] = shuffle(survey.drivers);
    return reply
      .code(form.status ?? 200)
      .header('cache-control', 'no-store')
      .view('form', {
        token: issueFormToken(secret, ctx.now().getTime(), form.test),
        src: form.src,
        rep: form.rep,
        test: form.test,
        drivers,
        values: form.values ?? null,
        errors,
        formError: form.formError ?? '',
        startStep,
        client: {
          titles: survey.step2.titles,
          errors: survey.errors,
          submit: survey.step3.submit,
          submitting: survey.step3.submitting,
          maxLength: survey.step2.commentMaxLength,
          test: form.test,
        },
      });
  };

  app.get('/', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const now = ctx.now();
    const test = req.admin !== null || isValidTestLink(secret, q.t, now.getTime());
    const state = surveyState(now, config);
    if (!test && state !== 'open') return stateMessage(reply, state);
    return renderForm(reply, { src: pickChannel(q.src, survey.channels), rep: cleanRep(q.rep), test });
  });

  app.post('/api/submit', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const json = String(req.headers['content-type'] ?? '').startsWith('application/json');
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const outcome = submitResponse(ctx, {
      body,
      mode: json ? 'json' : 'form',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    if (json) return sendJson(reply, outcome);

    // Classic form POST (no JavaScript): Post/Redirect/Get, or re-render the form with errors.
    const again = (extra: Partial<FormRender>) =>
      renderForm(reply, {
        src: pickChannel(body.src, survey.channels),
        rep: cleanRep(body.rep),
        test: readFormToken(secret, body.tk)?.test ?? false,
        status: 400,
        ...extra,
      });
    switch (outcome.kind) {
      case 'created': return reply.redirect('/thanks', 303);
      case 'duplicate': return reply.redirect('/already', 303);
      case 'not_open':
      case 'closed': return stateMessage(reply, outcome.kind, 403);
      case 'rate_limited':
        reply.header('retry-after', String(outcome.retryAfterSec));
        return errorMessage(reply, 429, survey.states.rateLimited);
      case 'rejected':
      case 'bad_token': return errorMessage(reply, 400);
      case 'too_fast': return again({ values: outcome.values, formError: survey.errors.tooFast });
      case 'invalid': return again({ values: outcome.values, errors: outcome.errors });
    }
  });

  function sendJson(reply: FastifyReply, outcome: SubmitOutcome) {
    switch (outcome.kind) {
      case 'created': return reply.code(201).send({ ok: true, status: 'created', category: outcome.category });
      case 'duplicate': return reply.code(409).send({ ok: false, error: 'duplicate', message: survey.states.duplicate });
      case 'not_open': return reply.code(403).send({ ok: false, error: 'not_open', message: survey.states.notOpen.replace('{date}', faFullDateTime(config.opensAt)) });
      case 'closed': return reply.code(403).send({ ok: false, error: 'closed', message: survey.states.closed });
      case 'rate_limited':
        return reply.code(429).header('retry-after', String(outcome.retryAfterSec))
          .send({ ok: false, error: 'rate_limited', message: survey.states.rateLimited });
      case 'rejected': return reply.code(400).send({ ok: false, error: 'rejected', message: survey.states.error });
      case 'bad_token': return reply.code(400).send({ ok: false, error: 'bad_token', message: survey.states.error });
      case 'too_fast': return reply.code(400).send({ ok: false, error: 'too_fast', message: survey.errors.tooFast });
      case 'invalid': {
        const first = outcome.errors.score ? survey.errors.score : outcome.errors.mobile ? survey.errors.mobile : survey.errors.comment;
        return reply.code(400).send({ ok: false, error: 'invalid', fields: outcome.errors, message: first });
      }
    }
  }

  // Funnel events from sendBeacon (text/plain JSON). Signed token → no invented sessions; test sessions ignored.
  app.post('/api/events', { bodyLimit: 2048 }, async (req, reply) => {
    let data: unknown = req.body;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return reply.code(400).send({ ok: false });
      }
    }
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const token = readFormToken(secret, d.tk);
    if (!token || (d.type !== 'view' && d.type !== 'score_selected' && d.type !== 'step2_done')) {
      return reply.code(400).send({ ok: false });
    }
    if (!token.test) ctx.repo.insertEvent(token.sid, d.type, pickChannel(d.src, survey.channels), ctx.now().toISOString());
    return reply.code(204).send();
  });

  app.get('/thanks', async (_req, reply) =>
    message(reply, 200, { title: survey.thanks.title, text: survey.thanks.text, shop: true }));

  app.get('/already', async (_req, reply) =>
    message(reply, 200, { title: survey.states.duplicateTitle, text: survey.states.duplicate, emoji: '🙏', shop: true }));

  app.get('/healthz', async (_req, reply) => {
    healthCheck.get();
    return reply.header('cache-control', 'no-store').send({ ok: true });
  });

  app.get('/robots.txt', async (_req, reply) => reply.type('text/plain; charset=utf-8').send('User-agent: *\nDisallow: /\n'));

  app.get('/favicon.ico', async (_req, reply) => reply.redirect(ctx.assets.url('img/favicon.svg'), 301));
}
