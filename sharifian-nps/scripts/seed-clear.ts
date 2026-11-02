// npm run seed:clear — removes only demo rows (customers.is_demo, responses.kind='demo', events 'demo-*').
// Real data is never touched, so it is safe to run at any time.
import { ConfigError, loadConfig, loadDotEnv } from '../src/config.ts';
import { openDb } from '../src/db/db.ts';
import { clearDemo } from '../src/services/demo.ts';

try {
  loadDotEnv();
  const config = loadConfig();
  const db = openDb(config.databasePath);
  const removed = clearDemo(db);
  db.close();
  console.log(`داده‌ی دمو پاک شد: ${removed.customers} مشتری، ${removed.responses} پاسخ، ${removed.events} رویداد. داده‌ی واقعی دست نخورد.`);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
