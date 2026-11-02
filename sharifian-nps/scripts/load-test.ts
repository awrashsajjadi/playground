// npm run test:load — autocannon against a real server in a separate process.
//  A) 100 concurrent visitors on the form page for 10 s
//  B) 500 submissions (unique mobiles, valid tokens) over 50 concurrent connections
// Pass criteria (PROMPT.md §8): p95 < 300 ms and zero errors / non-2xx.
import autocannon from 'autocannon';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 4280; // not 4190: that one is on the Fetch spec "bad ports" list (sieve)
const BASE = `http://127.0.0.1:${PORT}`;
const P95_LIMIT_MS = 300;
const root = fileURLToPath(new URL('..', import.meta.url));

const server = spawn(process.execPath, ['scripts/serve-test.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), RATE_LIMIT_PER_HOUR: '0' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('test server did not start');
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

interface Outcome {
  name: string;
  requests: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  rps: number;
  errors: number;
  non2xx: number;
}

async function run(name: string, options: autocannon.Options): Promise<Outcome> {
  const latencies: number[] = [];
  const result = await new Promise<autocannon.Result>((resolve, reject) => {
    const instance = autocannon(options, (err, res) => (err ? reject(err) : resolve(res)));
    instance.on('response', (_client, _status, _bytes, responseTime) => {
      latencies.push(responseTime);
    });
  });
  latencies.sort((a, b) => a - b);
  return {
    name,
    requests: latencies.length,
    p50: Math.round(percentile(latencies, 50)),
    p95: Math.round(percentile(latencies, 95)),
    p99: Math.round(percentile(latencies, 99)),
    max: Math.round(latencies.at(-1) ?? 0),
    rps: Math.round(result.requests.average),
    errors: result.errors + result.timeouts,
    non2xx: result.non2xx,
  };
}

let exitCode = 1;
try {
  await waitForServer();

  const formPage = await run('A) فرم — ۱۰۰ کاربر هم‌زمان، ۱۰ ثانیه', {
    url: `${BASE}/?src=sms`,
    connections: 100,
    duration: 10,
  });

  // Tokens must exist and be older than the 3-second minimum before submitting.
  const TOTAL = 500;
  const tokens: string[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const html = await (await fetch(`${BASE}/?src=sms`)).text();
    const tk = /name="tk" value="([^"]+)"/.exec(html)?.[1];
    if (!tk) throw new Error('no form token');
    tokens.push(tk);
  }
  await new Promise((r) => setTimeout(r, 3200));
  const bodies = tokens.map((tk, i) =>
    JSON.stringify({
      tk,
      score: i % 11,
      drivers: ['price', 'delivery'],
      comment: 'تست بار: ارسال کمی دیر بود',
      mobile: `0935${String(i).padStart(7, '0')}`,
      src: 'sms',
      contact: true,
    }),
  );
  let next = 0;
  const submissions = await run('B) ثبت — ۵۰ اتصال هم‌زمان، ۵۰۰ موبایل یکتا', {
    url: BASE,
    connections: 50,
    amount: TOTAL,
    requests: [
      {
        method: 'POST',
        path: '/api/submit',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        setupRequest: (req) => ({ ...req, body: bodies[next++ % TOTAL] }),
      },
    ],
  });

  const rows = [formPage, submissions];
  console.log('\n| سناریو | درخواست | req/s | p50 | p95 | p99 | max | خطا | non-2xx |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.name} | ${r.requests} | ${r.rps} | ${r.p50}ms | ${r.p95}ms | ${r.p99}ms | ${r.max}ms | ${r.errors} | ${r.non2xx} |`);
  }
  const failed = rows.filter((r) => r.p95 >= P95_LIMIT_MS || r.errors > 0 || r.non2xx > 0 || r.requests === 0);
  if (submissions.requests !== TOTAL) failed.push(submissions);
  console.log(failed.length ? `\nFAILED: ${failed.map((f) => f.name).join(', ')}` : `\nPASS: p95 < ${P95_LIMIT_MS}ms، بدون خطا`);
  exitCode = failed.length ? 1 : 0;
} catch (err) {
  console.error(err);
} finally {
  server.kill('SIGTERM');
}
process.exit(exitCode);
