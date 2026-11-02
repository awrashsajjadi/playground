import { describe, expect, it } from 'vitest';
import {
  dayKeyToDate, faDate, faDateTime, faFullDateTime, faNumericDate, faWeekdayDate, shamsiStamp, tehranDayKey,
} from '../../src/core/date.ts';
import { faDigits, faNumber, faPercent, faSigned, toAsciiDigits } from '../../src/core/fa.ts';

describe('Tehran / Shamsi dates', () => {
  const opens = '2026-11-08T08:00:00+03:30'; // = 2026-11-08T04:30:00Z

  it('converts to the Persian calendar in Tehran time', () => {
    expect(faDate(opens)).toBe('۱۷ آبان ۱۴۰۵');
    expect(faDateTime(opens)).toBe('۱۷ آبان ۱۴۰۵، ساعت ۸:۰۰');
    expect(faFullDateTime(opens)).toBe('یکشنبه ۱۷ آبان ۱۴۰۵، ساعت ۸:۰۰');
    expect(faWeekdayDate('2026-11-14T23:59:59+03:30')).toBe('شنبه ۲۳ آبان');
    expect(faNumericDate(opens)).toBe('۱۴۰۵/۰۸/۱۷');
    expect(shamsiStamp(opens)).toBe('1405-08-17');
  });

  it('uses the Tehran day, not the UTC day, around midnight', () => {
    expect(tehranDayKey('2026-11-07T20:29:59Z')).toBe('2026-11-07'); // 23:59:59 Tehran
    expect(tehranDayKey('2026-11-07T20:30:00Z')).toBe('2026-11-08'); // 00:00 Tehran
    expect(faDate('2026-11-07T21:00:00Z')).toBe('۱۷ آبان ۱۴۰۵'); // 00:30 Tehran, still 7 Nov in UTC
  });

  it('handles Nowruz (1 Farvardin 1405 = 21 March 2026)', () => {
    expect(faDate('2026-03-20T20:30:00Z')).toBe('۱ فروردین ۱۴۰۵');
    expect(faDate('2026-03-20T20:29:00Z')).toBe('۲۹ اسفند ۱۴۰۴');
  });

  it('maps a day key back to that Tehran day', () => {
    expect(tehranDayKey(dayKeyToDate('2026-11-08'))).toBe('2026-11-08');
  });

  it('rejects invalid dates', () => {
    expect(() => faDate('not a date')).toThrow(RangeError);
  });
});

describe('Persian digits', () => {
  it('converts both ways', () => {
    expect(faDigits(2026)).toBe('۲۰۲۶');
    expect(toAsciiDigits('۰۹۱۲ ٣٤٥')).toBe('0912 345');
  });

  it('formats numbers, percents and signed values', () => {
    expect(faNumber(1234)).toBe('۱٬۲۳۴');
    expect(faNumber(12.345, 1)).toBe('۱۲٫۳');
    expect(faPercent(0.425)).toBe('۴۳٪');
    expect(faSigned(42)).toBe('+۴۲');
    expect(faSigned(-12)).toBe('−۱۲');
    expect(faSigned(0)).toBe('۰');
    expect(faSigned(-0.04)).toBe('۰');
  });
});
