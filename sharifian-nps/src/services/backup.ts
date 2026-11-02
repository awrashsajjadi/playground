// Automatic daily snapshot inside the app (D33): once per Tehran day a consistent copy of the database is
// written to BACKUP_DIR as daily-YYYY-MM-DD.db, and only the newest 7 are kept. Needs no cron, so it also
// works on Liara. scripts/backup.sh (manual-*.db) and the panel's download button are the other two layers.
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tehranDayKey } from '../core/date.ts';
import type { DB } from '../db/db.ts';

export const KEEP_DAILY = 7;
const DAILY = /^daily-\d{4}-\d{2}-\d{2}\.db$/;

export function dailyBackupName(now: Date): string {
  return `daily-${tehranDayKey(now)}.db`;
}

/**
 * A copy of a WAL-mode database is itself in WAL mode, and opening it later creates -wal/-shm files beside it.
 * Switching the copy to a plain rollback journal makes every backup one self-contained file.
 */
export function makeSingleFile(path: string): void {
  const copy = new Database(path);
  try {
    copy.pragma('journal_mode = DELETE');
  } finally {
    copy.close();
  }
}

/** Deletes the oldest daily snapshots beyond `keep`; other files in the folder are never touched. */
export function pruneDailyBackups(dir: string, keep = KEEP_DAILY): string[] {
  const files = readdirSync(dir).filter((f) => DAILY.test(f)).sort(); // ISO dates sort chronologically
  const old = files.slice(0, Math.max(0, files.length - keep));
  for (const f of old) rmSync(join(dir, f), { force: true });
  return old;
}

/** Writes today's snapshot unless it already exists. Returns the new file, or null if today is done. */
export async function runDailyBackup(db: DB, dir: string, now: Date, keep = KEEP_DAILY): Promise<string | null> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, dailyBackupName(now));
  let written: string | null = null;
  if (!existsSync(file)) {
    // Write to a temp name and rename, so a crash mid-copy never leaves a broken file that looks finished.
    const tmp = `${file}.tmp`;
    rmSync(tmp, { force: true });
    await db.backup(tmp);
    makeSingleFile(tmp);
    renameSync(tmp, file);
    written = file;
  }
  pruneDailyBackups(dir, keep);
  return written;
}

export interface BackupInfo {
  name: string;
  bytes: number;
  at: Date;
}

/** Newest first; an unreadable or missing folder is just "no backups yet". */
export function listBackups(dir: string): BackupInfo[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.db'))
      .map((name) => {
        const s = statSync(join(dir, name));
        return { name, bytes: s.size, at: s.mtime };
      })
      .sort((a, b) => b.at.getTime() - a.at.getTime());
  } catch {
    return [];
  }
}

interface Log {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Checks soon after start and then hourly, so restarts or a paused container still get the day's copy. */
export function startDailyBackups(db: DB, dir: string, now: () => Date, log: Log): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runDailyBackup(db, dir, now())
      .then((file) => {
        if (file) log.info({ file }, 'daily backup written');
      })
      .catch((err: unknown) => log.error({ err }, 'daily backup failed'))
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(tick, 20_000);
  const hourly = setInterval(tick, 3600_000);
  first.unref();
  hourly.unref();
  return () => {
    clearTimeout(first);
    clearInterval(hourly);
  };
}
