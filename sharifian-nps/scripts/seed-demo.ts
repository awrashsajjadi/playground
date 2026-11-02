// npm run seed:demo — fills the configured database with clearly-marked demo data.
// Refuses to run on a database that already holds real customers or responses (use --force to override).
import { ConfigError, loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/db.ts';
import { hasRealData, seedDemo } from '../src/services/demo.ts';

try {
  const config = loadConfig();
  const db = openDb(config.databasePath);
  if (hasRealData(db) && !process.argv.includes('--force')) {
    console.error('دیتابیس داده‌ی واقعی دارد؛ seed:demo اجرا نشد. (اگر مطمئنید: npm run seed:demo -- --force)');
    process.exit(1);
  }
  const result = seedDemo(db, config);
  db.close();
  console.log(`داده‌ی دمو ساخته شد: ${result.customers} مشتری، ${result.responses} پاسخ، ${result.events} رویداد قیف.`);
  console.log(`دیتابیس: ${config.databasePath} — قبل از کمپین واقعی: npm run seed:clear`);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
