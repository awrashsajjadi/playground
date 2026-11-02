// eta templates + helpers. reply.view(name, data) renders src/views/<name>.eta as UTF-8 HTML.
import { Eta } from 'eta';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { fileURLToPath } from 'node:url';
import { faDate, faDateTime, faFullDateTime, faNumericDate, faWeekdayDate } from '../core/date.ts';
import { faDigits, faNumber, faPercent, faSigned } from '../core/fa.ts';
import type { AppContext } from '../context.ts';
import { INLINE_SCRIPT } from './security.ts';

declare module 'fastify' {
  interface FastifyReply {
    view(name: string, data?: Record<string, unknown>): FastifyReply;
  }
}

const VIEWS_DIR = fileURLToPath(new URL('../views', import.meta.url));

/** JSON safe to embed inside <script type="application/json">. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function createHelpers(ctx: Pick<AppContext, 'assets' | 'config'>) {
  return {
    asset: (logical: string) => ctx.assets.url(logical),
    hasAsset: (logical: string) => ctx.assets.has(logical),
    fa: faDigits,
    faNumber,
    faPercent,
    faSigned,
    faDate,
    faDateTime,
    faFullDateTime,
    faWeekdayDate,
    faNumericDate,
    json: jsonForScript,
    inlineScript: INLINE_SCRIPT,
    channelLabel: (src: string) => ctx.config.survey.channels[src] ?? src,
  };
}

export type ViewHelpers = ReturnType<typeof createHelpers>;

export function setupViews(app: FastifyInstance, ctx: Pick<AppContext, 'assets' | 'config'>): void {
  const eta = new Eta({
    views: VIEWS_DIR,
    cache: ctx.config.env === 'production',
    autoEscape: true,
    autoTrim: false,
  });
  const h = createHelpers(ctx);
  const survey = ctx.config.survey;

  app.decorateReply('view', function view(this: FastifyReply, name: string, data: Record<string, unknown> = {}) {
    const html = eta.render(name, { survey, h, baseUrl: ctx.config.publicBaseUrl, ...data });
    return this.type('text/html; charset=utf-8').send(html);
  });
}
