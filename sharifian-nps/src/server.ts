// Entry point: config → database → app → listen. Run with `npm start` (Node ≥ 22.18 runs .ts directly).
import { networkInterfaces } from 'node:os';
import { buildApp, productionLogger } from './app.ts';
import { ConfigError, loadConfig, loadDotEnv, type AppConfig } from './config.ts';
import { openDb } from './db/db.ts';

/** Development only: where to open the app, including this computer's LAN address for testing on a phone. */
function devBanner(config: AppConfig): string {
  const everyInterface = config.host === '0.0.0.0' || config.host === '::';
  const lan = everyInterface
    ? Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((a) => a.family === 'IPv4' && !a.internal)
    : [];
  const url = (host: string, path = '') => `http://${host}:${config.port}${path}`.padEnd(40);
  return [
    '',
    `  ${url('localhost')} فرم نظرسنجی`,
    `  ${url('localhost', '/admin/dashboard')} داشبورد${process.env.ADMIN_PASSWORD ? '' : ' (رمز: admin)'}`,
    ...lan.map((a) => `  ${url(a.address)} روی گوشی (همان وای‌فای)`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  let config;
  try {
    loadDotEnv();
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  if (config.env === 'development') {
    // Rebuild browser bundles on every (watch) restart; esbuild is a dev dependency only.
    const { buildClient } = await import('../scripts/build-client.ts');
    await buildClient({ minify: false });
  }

  const db = openDb(config.databasePath);
  const app = await buildApp({
    config,
    db,
    logger: config.env === 'production' ? productionLogger() : { level: 'info' },
  });
  // In development the warnings go straight to the console so they always print before the address banner.
  for (const warning of config.warnings) {
    if (config.env === 'development') console.warn(`⚠ ${warning}`);
    else app.log.warn(warning);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  if (config.env === 'development') console.log(devBanner(config));
}

await main();
