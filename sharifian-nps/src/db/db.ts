import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const SCHEMA_VERSION = 1;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

/** Schema version lives in PRAGMA user_version; later versions add steps here. */
export function migrate(db: DB): void {
  const version = Number(db.pragma('user_version', { simple: true }));
  if (version >= SCHEMA_VERSION) return;
  db.transaction(() => {
    if (version < 1) db.exec(SCHEMA);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}
