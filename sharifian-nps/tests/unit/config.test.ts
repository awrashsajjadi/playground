import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, loadDotEnv, ROOT_DIR, surveyState } from '../../src/config.ts';

describe('loadConfig — development defaults', () => {
  it('without campaign dates, assumes a campaign that opened 5 days ago at 08:00 Tehran and closes in 2 days', () => {
    const now = new Date('2026-11-02T11:30:00+03:30');
    const config = loadConfig({ NODE_ENV: 'development' }, now.getTime());
    expect(config.opensAt.toISOString()).toBe(new Date('2026-10-28T08:00:00+03:30').toISOString());
    expect(config.closesAt.toISOString()).toBe(new Date('2026-11-04T23:59:59+03:30').toISOString());
    expect(surveyState(now, config)).toBe('open');
    expect(config.adminPassword).toBe('admin');
  });

  it('uses the Tehran date, not UTC, near midnight', () => {
    // 00:30 on 3 Nov in Tehran is still 2 Nov in UTC.
    const config = loadConfig({ NODE_ENV: 'development' }, Date.parse('2026-11-03T00:30:00+03:30'));
    expect(config.opensAt.toISOString()).toBe(new Date('2026-10-29T08:00:00+03:30').toISOString());
  });

  it('production refuses to start without the campaign dates, password and secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://nazar.sharifianshop.com' })).toThrow(
      /SURVEY_OPENS_AT[\s\S]*SURVEY_CLOSES_AT|ADMIN_PASSWORD/,
    );
  });
});

describe('.env loading (D89)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nps-env-'));
  afterEach(() => {
    delete process.env.NPS_TEST_FROM_FILE;
    delete process.env.NPS_TEST_ALREADY_SET;
  });

  it('a missing .env is fine', () => {
    expect(loadDotEnv(join(dir, 'missing.env'))).toBe(false);
  });

  it('loads the file, but a variable already set in the environment wins', () => {
    const file = join(dir, '.env');
    writeFileSync(file, 'NPS_TEST_FROM_FILE=file\nNPS_TEST_ALREADY_SET=file\n');
    process.env.NPS_TEST_ALREADY_SET = 'platform';
    expect(loadDotEnv(file)).toBe(true);
    expect(process.env.NPS_TEST_FROM_FILE).toBe('file');
    expect(process.env.NPS_TEST_ALREADY_SET).toBe('platform');
    rmSync(file);
  });

  it('npm scripts never pass --env-file to node --watch (Node 22 crashes when .env does not exist)', () => {
    const scripts: Record<string, string> = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8')).scripts;
    for (const [name, cmd] of Object.entries(scripts)) {
      expect(cmd.includes('--watch') && cmd.includes('--env-file'), name).toBe(false);
    }
  });
});
