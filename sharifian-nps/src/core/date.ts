// Dates are stored as UTC ISO strings and converted to Tehran time + Shamsi calendar only for display.
// Uses Intl only (no library). Composed from parts because ICU's default fa pattern is "year month day, weekday".
import { toAsciiDigits } from './fa.ts';

export const TEHRAN_TZ = 'Asia/Tehran';

type DateInput = Date | string | number;

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TEHRAN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const fullFormat = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
});
const numericFormat = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

function toDate(value: DateInput): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(value)}`);
  return date;
}

function parts(format: Intl.DateTimeFormat, value: DateInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of format.formatToParts(toDate(value))) out[part.type] = part.value;
  return out;
}

/** Gregorian calendar day in Tehran, e.g. "2026-11-08" — used to bucket responses per day. */
export function tehranDayKey(value: DateInput): string {
  return dayKeyFormat.format(toDate(value));
}

/** ۱۷ آبان ۱۴۰۵ */
export function faDate(value: DateInput): string {
  const p = parts(fullFormat, value);
  return `${p.day} ${p.month} ${p.year}`;
}

/** ۱۷ آبان ۱۴۰۵، ساعت ۸:۰۵ */
export function faDateTime(value: DateInput): string {
  const p = parts(fullFormat, value);
  return `${p.day} ${p.month} ${p.year}، ساعت ${p.hour}:${p.minute}`;
}

/** یکشنبه ۱۷ آبان ۱۴۰۵، ساعت ۸:۰۵ */
export function faFullDateTime(value: DateInput): string {
  const p = parts(fullFormat, value);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}، ساعت ${p.hour}:${p.minute}`;
}

/** یکشنبه ۱۷ آبان */
export function faWeekdayDate(value: DateInput): string {
  const p = parts(fullFormat, value);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** ۱۴۰۵/۰۸/۱۷ */
export function faNumericDate(value: DateInput): string {
  const p = parts(numericFormat, value);
  return `${p.year}/${p.month}/${p.day}`;
}

/** 1405-08-17 (ASCII, for file names) */
export function shamsiStamp(value: DateInput): string {
  const p = parts(numericFormat, value);
  return toAsciiDigits(`${p.year}-${p.month}-${p.day}`);
}

/** 1405/08/17 14:05 (ASCII digits, sortable — for CSV exports) */
export function shamsiDateTimeAscii(value: DateInput): string {
  const p = parts(fullFormat, value);
  const n = parts(numericFormat, value);
  return toAsciiDigits(`${n.year}/${n.month}/${n.day} ${(p.hour ?? '').padStart(2, '۰')}:${p.minute}`);
}

/** A Tehran day key ("2026-11-08") → that day's local noon, handy for labelling buckets. */
export function dayKeyToDate(key: string): Date {
  return new Date(`${key}T12:00:00+03:30`);
}
