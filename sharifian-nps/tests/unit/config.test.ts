import { describe, expect, it } from 'vitest';
import { loadConfig, surveyState } from '../../src/config.ts';

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
