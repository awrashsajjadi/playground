// Security headers, a strict CSP, and gzip for dynamic text responses.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';

/**
 * The only inline script: marks <html> as JS-capable before first paint (no flash of all three steps).
 * If the bundle never runs (blocked/failed), it falls back to the no-JS single-page layout after 8s.
 */
export const INLINE_SCRIPT =
  "(function(e){e.className+=' js';setTimeout(function(){if(!window.__nps){e.className=e.className.replace(/\\bjs\\b/,'')}},8000)})(document.documentElement)";

export const INLINE_SCRIPT_HASH = `'sha256-${createHash('sha256').update(INLINE_SCRIPT).digest('base64')}'`;

export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SCRIPT_HASH}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const COMPRESSIBLE_TYPE = /^(text\/|application\/(json|javascript))/;

export function setupSecurity(app: FastifyInstance, options: { production: boolean }): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header('x-robots-tag', 'noindex, nofollow');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      reply.header('content-security-policy', CSP);
    }
    if (options.production) reply.header('strict-transport-security', 'max-age=15552000');
    return payload;
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (reply.getHeader('content-encoding')) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    if (!COMPRESSIBLE_TYPE.test(String(reply.getHeader('content-type') ?? ''))) return payload;
    const size = typeof payload === 'string' ? Buffer.byteLength(payload) : payload.length;
    if (size < 1024) return payload;
    reply.header('vary', 'Accept-Encoding');
    if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return payload;
    reply.header('content-encoding', 'gzip');
    return gzipSync(payload, { level: 6 });
  });
}
