import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../src/db/db.ts';
import { dailyBackupName, listBackups, pruneDailyBackups, runDailyBackup } from '../../src/services/backup.ts';

let dir: string;
let db: DB;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nps-backup-'));
  db = openDb(join(dir, 'nps.db'));
  db.prepare("INSERT INTO customers (mobile, name, imported_at) VALUES ('09120000001', 'تست', '2026-11-01T00:00:00Z')").run();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('automatic daily backup (D33)', () => {
  it('names the file by the Tehran date, not UTC', () => {
    expect(dailyBackupName(new Date('2026-11-08T21:00:00Z'))).toBe('daily-2026-11-09.db'); // 00:30 in Tehran
  });

  it('writes one consistent copy per Tehran day, with no temp file left behind', async () => {
    const backups = join(dir, 'backups');
    const file = await runDailyBackup(db, backups, new Date('2026-11-09T06:00:00Z'));
    expect(file).toBe(join(backups, 'daily-2026-11-09.db'));
    const copy = new Database(file!, { readonly: true });
    expect(copy.prepare('SELECT name FROM customers').get()).toEqual({ name: 'تست' });
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(copy.pragma('journal_mode', { simple: true })).toBe('delete'); // one self-contained file
    copy.close();

    expect(await runDailyBackup(db, backups, new Date('2026-11-09T19:00:00Z'))).toBeNull(); // same day in Tehran
    expect(readdirSync(backups)).toEqual(['daily-2026-11-09.db']);
  });

  it('keeps the newest 7 daily files and never touches anything else in the folder', () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    for (let d = 1; d <= 9; d++) writeFileSync(join(backups, `daily-2026-11-0${d}.db`), '');
    writeFileSync(join(backups, 'manual-2026-11-01T0800Z.db'), '');
    writeFileSync(join(backups, 'notes.txt'), '');
    expect(pruneDailyBackups(backups)).toEqual(['daily-2026-11-01.db', 'daily-2026-11-02.db']);
    expect(readdirSync(backups).sort()).toEqual(
      [...[3, 4, 5, 6, 7, 8, 9].map((d) => `daily-2026-11-0${d}.db`), 'manual-2026-11-01T0800Z.db', 'notes.txt'].sort(),
    );
  });

  it('lists backups newest first; a missing folder means "none yet"', () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    writeFileSync(join(backups, 'daily-2026-11-08.db'), 'x');
    writeFileSync(join(backups, 'manual-2026-11-09T0800Z.db'), 'xy');
    const at = (name: string, iso: string) => utimesSync(join(backups, name), new Date(iso), new Date(iso));
    at('daily-2026-11-08.db', '2026-11-08T05:00:00Z');
    at('manual-2026-11-09T0800Z.db', '2026-11-09T08:00:00Z');
    expect(listBackups(backups).map((b) => [b.name, b.bytes])).toEqual([
      ['manual-2026-11-09T0800Z.db', 2],
      ['daily-2026-11-08.db', 1],
    ]);
    expect(listBackups(join(dir, 'nope'))).toEqual([]);
  });
});
