// Entry point: config → database → app → listen. Run with `npm start` (Node ≥ 22.18 runs .ts directly).
import { buildApp, productionLogger } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import { openDb } from './db/db.ts';

async function main(): Promise<void> {
  let config;
  try {
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
  for (const warning of config.warnings) app.log.warn(warning);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

await main();
