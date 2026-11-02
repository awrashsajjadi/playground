import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, detectDelimiter, parseCsv, toCsv } from '../../src/core/csv.ts';
import { parseCustomersCsv } from '../../src/core/customers-csv.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const BOM = '\uFEFF';

/** windows-1256 bytes for the few letters used below. */
function win1256(s: string): Uint8Array {
  const table: Record<string, number> = { 'ا': 0xc7, 'د': 0xcf, 'س': 0xd3, 'ش': 0xd4, 'ل': 0xe1, 'م': 0xe3, 'ه': 0xe5 };
  const out: number[] = [];
  for (const ch of s) out.push(table[ch] ?? ch.charCodeAt(0));
  return Uint8Array.from(out);
}

describe('decodeCsvBytes', () => {
  it('detects UTF-8 with BOM', () => {
    const r = decodeCsvBytes(utf8(`${BOM}موبایل,نام`));
    expect(r.encoding).toBe('utf-8-bom');
    expect(r.text).toBe('موبایل,نام');
  });

  it('detects plain UTF-8', () => {
    expect(decodeCsvBytes(utf8('موبایل')).encoding).toBe('utf-8');
  });

  it('detects UTF-16LE with BOM (Excel "Unicode Text")', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('نام\tشهر', 'utf16le')]);
    const r = decodeCsvBytes(buf);
    expect(r.encoding).toBe('utf-16le');
    expect(r.text).toBe('نام\tشهر');
  });

  it('falls back to windows-1256 for Excel ANSI files', () => {
    const r = decodeCsvBytes(win1256('سلام,مشهد'));
    expect(r.encoding).toBe('windows-1256');
    expect(r.text).toBe('سلام,مشهد');
  });
});

describe('parseCsv', () => {
  it('detects , ; tab and Arabic semicolon', () => {
    expect(detectDelimiter('a,b,c\n1;2')).toBe(',');
    expect(detectDelimiter('a;b;c\n1,2')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('الف؛ب؛ج')).toBe('؛');
    expect(detectDelimiter('"x;y",b,c')).toBe(',');
  });

  it('handles quotes, escaped quotes, embedded newlines, CRLF and blank lines', () => {
    const rows = parseCsv('name,comment\r\n"Ali","said ""hi"""\r\n\r\n"Sara","line1\nline2"\r\n');
    expect(rows.map((r) => r.cells)).toEqual([
      ['name', 'comment'],
      ['Ali', 'said "hi"'],
      ['Sara', 'line1\nline2'],
    ]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('strips a BOM and tolerates an unterminated quote (broken row)', () => {
    const rows = parseCsv(`${BOM}a,b\n1,"oops\n2,3`);
    expect(rows[0]?.cells).toEqual(['a', 'b']);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.cells[1]).toBe('oops\n2,3');
  });
});

describe('toCsv', () => {
  it('writes BOM, CRLF and escapes quotes/commas/newlines', () => {
    const out = toCsv([['نام', 'متن'], ['علی', 'گفت "سلام", خوب'], ['x', 'a\nb']]);
    expect(out.startsWith(BOM)).toBe(true);
    expect(out).toBe(`${BOM}نام,متن\r\nعلی,"گفت ""سلام"", خوب"\r\nx,"a\nb"\r\n`);
  });

  it('neutralises formulas in text but not in numbers', () => {
    const out = toCsv([['=HYPERLINK("x")', '+98', '@cmd', '-ارسال دیر', -12, 0]], { bom: false });
    expect(out).toBe(`"'=HYPERLINK(""x"")",'+98,'@cmd,'-ارسال دیر,-12,0\r\n`);
  });

  it('keeps leading zeros of mobile numbers as text', () => {
    expect(toCsv([['09121234567']], { bom: false })).toBe('09121234567\r\n');
  });
});

describe('parseCustomersCsv', () => {
  const header = 'mobile,name,company,city,province,customer_type,value_tier,sales_rep,first_purchase_date';

  it('parses the spec columns with BOM', () => {
    const csv = `${BOM}${header}\n09121234567,علی رضایی,عطاری رضایی,تهران,تهران,عطاری,A,r01,1401/05/12\n`;
    const r = parseCustomersCsv(utf8(csv));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.encoding).toBe('utf-8-bom');
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      mobile: '09121234567', name: 'علی رضایی', value_tier: 'A', sales_rep: 'r01', first_purchase_date: '1401/05/12',
    });
  });

  it('accepts ; delimiter, Persian headers, Persian digits and Persian tiers', () => {
    const csv = 'موبایل;نام;شهر;سطح;کارشناس فروش\n۰۹۱۲ ۱۲۳ ۴۵۶۷;سارا;مشهد;ب;r02\n';
    const r = parseCustomersCsv(utf8(csv));
    if (!r.ok) throw new Error('parse failed');
    expect(r.delimiter).toBe(';');
    expect(r.columns.map((c) => c.field)).toEqual(['mobile', 'name', 'city', 'value_tier', 'sales_rep']);
    expect(r.records[0]).toMatchObject({ mobile: '09121234567', city: 'مشهد', value_tier: 'B', sales_rep: 'r02', company: null });
  });

  it('reports invalid, missing and duplicate mobiles with line numbers; skips broken rows', () => {
    const csv = [
      header,
      '09121111111,یک,,,,,A,,',
      '02188888888,ثابت,,,,,,,',
      ',بی‌شماره,,,,,,,',
      '+98 912 111 1111,تکراری,,,,,,,',
      '09122222222,بد-سطح,,,,,Z,,',
    ].join('\n');
    const r = parseCustomersCsv(utf8(csv));
    if (!r.ok) throw new Error('parse failed');
    expect(r.totalRows).toBe(5);
    expect(r.records.map((x) => x.mobile)).toEqual(['09121111111', '09122222222']);
    expect(r.errors).toEqual([
      { line: 3, code: 'mobile_invalid', value: '02188888888' },
      { line: 4, code: 'mobile_missing' },
      { line: 5, code: 'duplicate_in_file', value: '09121111111', firstLine: 2 },
    ]);
    expect(r.warnings).toEqual([{ line: 6, code: 'tier_invalid', value: 'Z' }]);
    expect(r.records[1]?.value_tier).toBeNull();
  });

  it('unifies Arabic ي/ك in text fields so segments group correctly', () => {
    const r = parseCustomersCsv(utf8('mobile,city,customer_type\n09121234567,كرج,سوپرماركت\n'));
    if (!r.ok) throw new Error('parse failed');
    expect(r.records[0]).toMatchObject({ city: 'کرج', customer_type: 'سوپرمارکت' });
  });

  it('fails clearly without a mobile column or with an empty file', () => {
    expect(parseCustomersCsv(utf8('name,city\nعلی,تهران'))).toEqual({ ok: false, error: 'no_mobile_column' });
    expect(parseCustomersCsv(utf8(''))).toEqual({ ok: false, error: 'empty' });
  });

  it('reads windows-1256 files', () => {
    const bytes = win1256('mobile,city\n09121234567,مشهد\n');
    const r = parseCustomersCsv(bytes);
    if (!r.ok) throw new Error('parse failed');
    expect(r.encoding).toBe('windows-1256');
    expect(r.records[0]?.city).toBe('مشهد');
  });
});
