// Static files served from memory under content-hashed URLs (immutable cache + pre-gzipped text).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.css', '.js', '.svg', '.txt', '.json']);

interface Asset {
  url: string;
  type: string;
  body: Buffer;
  gzip: Buffer | null;
}

export interface Assets {
  /** Logical path (e.g. "css/form.css") → hashed URL. */
  url(logical: string): string;
  has(logical: string): boolean;
  byUrl(url: string): Asset | undefined;
  /** Bytes as sent over the wire (gzip when it helps) — used for the page-weight budget. */
  wireSize(logical: string): number;
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, base);
    return entry.name.startsWith('.') ? [] : [relative(base, full).split(sep).join('/')];
  });
}

export function loadAssets(publicDir: string): Assets {
  const byLogical = new Map<string, Asset>();
  const byUrl = new Map<string, Asset>();

  const add = (logical: string, body: Buffer) => {
    const ext = extname(logical);
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 10);
    const gz = COMPRESSIBLE.has(ext) ? gzipSync(body, { level: 9 }) : null;
    const asset: Asset = {
      url: `/assets/${logical.slice(0, -ext.length)}.${hash}${ext}`,
      type: TYPES[ext] ?? 'application/octet-stream',
      body,
      gzip: gz && gz.length < body.length ? gz : null,
    };
    byLogical.set(logical, asset);
    byUrl.set(asset.url, asset);
  };

  const files = walk(publicDir);
  // Non-CSS first, so CSS can point at the hashed font/image URLs.
  for (const file of files.filter((f) => !f.endsWith('.css'))) add(file, readFileSync(join(publicDir, file)));
  for (const file of files.filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(join(publicDir, file), 'utf8').replace(
      /url\(\s*(['"]?)\/assets\/([^'")?#]+)\1\s*\)/g,
      (match, quote: string, logical: string) => {
        const target = byLogical.get(logical);
        return target ? `url(${quote}${target.url}${quote})` : match;
      },
    );
    add(file, Buffer.from(css));
  }

  return {
    url(logical) {
      const asset = byLogical.get(logical);
      if (!asset) throw new Error(`Unknown asset "${logical}" — run "npm run build" first.`);
      return asset.url;
    },
    has: (logical) => byLogical.has(logical),
    byUrl: (url) => byUrl.get(url),
    wireSize(logical) {
      const asset = byLogical.get(logical);
      return asset ? (asset.gzip ?? asset.body).length : 0;
    },
  };
}

export function setupAssets(app: FastifyInstance, assets: Assets): void {
  app.get('/assets/*', (req, reply) => {
    const asset = assets.byUrl(req.url.split('?')[0] ?? '');
    if (!asset) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('vary', 'Accept-Encoding')
      .type(asset.type);
    if (asset.gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      return reply.header('content-encoding', 'gzip').send(asset.gzip);
    }
    return reply.send(asset.body);
  });
}
