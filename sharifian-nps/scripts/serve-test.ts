// Test server for E2E and load tests: real HTTP server, throwaway database, open survey window,
// plus a fake Bale Bot API on PORT+1 that records alerts (GET /received returns them as JSON).
import { createServer } from 'node:http';
import { buildClient } from './build-client.ts';
import { startTestServer } from './test-server.ts';

const port = Number(process.env.PORT ?? 4173);
const balePort = port + 1;
const received: unknown[] = [];

const bale = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/received') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(received));
    return;
  }
  let body = '';
  req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
  req.on('end', () => {
    try {
      received.push({ path: req.url, body: JSON.parse(body) as unknown });
    } catch {
      received.push({ path: req.url, raw: body });
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"result":{}}');
  });
});
await new Promise<void>((resolve) => bale.listen(balePort, '127.0.0.1', resolve));

if (process.env.SKIP_BUILD !== '1') await buildClient();
const server = await startTestServer({
  PORT: String(port),
  RATE_LIMIT_PER_HOUR: process.env.RATE_LIMIT_PER_HOUR ?? '0',
  DETRACTOR_WEBHOOK_URL: `http://127.0.0.1:${balePort}/bot123:TEST/sendMessage?chat_id=4242`,
  ...(process.env.SURVEY_OPENS_AT ? { SURVEY_OPENS_AT: process.env.SURVEY_OPENS_AT } : {}),
  ...(process.env.SURVEY_CLOSES_AT ? { SURVEY_CLOSES_AT: process.env.SURVEY_CLOSES_AT } : {}),
}, port);
console.log(`test server ready on ${server.url} (fake Bale on http://127.0.0.1:${balePort})`);

const stop = async () => {
  await server.close();
  bale.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
