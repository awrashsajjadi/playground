// Admin session: one shared password, stateless signed cookie, HMAC-derived CSRF token.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hmac, randomId, safeEqual, signValue, unsignValue } from '../core/crypto.ts';

export const SESSION_COOKIE = 'nps_admin';
export const SESSION_TTL_SEC = 7 * 24 * 3600;

export interface AdminSession {
  sid: string;
  name: string;
  exp: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin: AdminSession | null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export function cleanAdminName(value: unknown): string {
  return (typeof value === 'string' ? value : '').replace(/[\p{C}<>]/gu, '').trim().slice(0, 40);
}

export function createSessionValue(secret: string, name: string, nowMs: number): string {
  const payload = Buffer.from(JSON.stringify({ sid: randomId(9), name, exp: nowMs + SESSION_TTL_SEC * 1000 })).toString('base64url');
  return signValue(secret, 'session', payload);
}

export function readSessionValue(secret: string, value: string | undefined, nowMs: number): AdminSession | null {
  const payload = unsignValue(secret, 'session', value);
  if (!payload) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<AdminSession>;
    if (typeof s.sid !== 'string' || typeof s.exp !== 'number' || s.exp <= nowMs) return null;
    return { sid: s.sid, name: typeof s.name === 'string' ? s.name : '', exp: s.exp };
  } catch {
    return null;
  }
}

export function csrfToken(secret: string, session: AdminSession): string {
  return hmac(secret, `csrf:${session.sid}`, 32);
}

export function sessionCookie(value: string, secure: boolean, maxAgeSec = SESSION_TTL_SEC): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function setupAuth(app: FastifyInstance, options: { secret: string; now: () => Date }): void {
  app.decorateRequest('admin', null);
  app.addHook('onRequest', async (req) => {
    const value = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.admin = value ? readSessionValue(options.secret, value, options.now().getTime()) : null;
  });
}

/** preHandler for /admin/*: GET without a session → login redirect; other methods → 401; POSTs need CSRF. */
export function requireAdmin(secret: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.admin) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        return reply.redirect(`/admin/login?next=${encodeURIComponent(req.url)}`, 302);
      }
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const header = req.headers['x-csrf-token'];
      const body = req.body as Record<string, unknown> | null | undefined;
      const token = typeof header === 'string' ? header : typeof body?._csrf === 'string' ? body._csrf : '';
      if (!token || !safeEqual(token, csrfToken(secret, req.admin))) {
        return reply.code(403).send({ ok: false, error: 'csrf' });
      }
    }
  };
}
