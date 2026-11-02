// Customer list CSV → validated records (pure; DB upsert lives in services/customers.ts).
import { decodeCsvBytes, detectDelimiter, parseCsv, type CsvEncoding } from './csv.ts';
import { normalizeMobile } from './mobile.ts';
import { normalizeFa } from './themes.ts';

export const CUSTOMER_FIELDS = [
  'mobile', 'name', 'company', 'city', 'province',
  'customer_type', 'value_tier', 'sales_rep', 'first_purchase_date',
] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

export interface CustomerRecord {
  mobile: string;
  name: string | null;
  company: string | null;
  city: string | null;
  province: string | null;
  customer_type: string | null;
  value_tier: 'A' | 'B' | 'C' | null;
  sales_rep: string | null;
  first_purchase_date: string | null;
}

export interface ImportIssue {
  line: number;
  code: 'mobile_missing' | 'mobile_invalid' | 'duplicate_in_file' | 'tier_invalid';
  value?: string;
  firstLine?: number;
}

export interface ParsedCustomers {
  ok: true;
  encoding: CsvEncoding;
  delimiter: string;
  columns: { header: string; field: CustomerField | null }[];
  totalRows: number;
  records: (CustomerRecord & { line: number })[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

export interface ParseFailure {
  ok: false;
  error: 'empty' | 'no_mobile_column' | 'too_many_rows';
}

export const MAX_IMPORT_ROWS = 20_000;

// Header aliases (English names from the spec + common Persian headers). Compared after normalization.
const ALIASES: Record<CustomerField, string[]> = {
  mobile: ['mobile', 'phone', 'mobile number', 'cell', 'موبایل', 'شماره موبایل', 'تلفن همراه', 'شماره همراه', 'همراه', 'شماره'],
  name: ['name', 'full name', 'نام', 'نام و نام خانوادگی', 'نام مشتری'],
  company: ['company', 'shop', 'store', 'شرکت', 'نام شرکت', 'فروشگاه', 'نام فروشگاه', 'مغازه'],
  city: ['city', 'شهر'],
  province: ['province', 'state', 'استان'],
  customer_type: ['customer_type', 'customer type', 'type', 'نوع مشتری', 'نوع', 'صنف'],
  value_tier: ['value_tier', 'value tier', 'tier', 'سطح', 'سطح مشتری', 'رده', 'تیر'],
  sales_rep: ['sales_rep', 'sales rep', 'rep', 'کارشناس', 'کارشناس فروش', 'ویزیتور'],
  first_purchase_date: ['first_purchase_date', 'first purchase date', 'تاریخ اولین خرید', 'اولین خرید'],
};

const headerKey = (h: string) => normalizeFa(h).replace(/\s+/g, '');

const HEADER_LOOKUP = new Map<string, CustomerField>();
for (const field of CUSTOMER_FIELDS) {
  for (const alias of ALIASES[field]) HEADER_LOOKUP.set(headerKey(alias), field);
}

const TIERS: Record<string, 'A' | 'B' | 'C'> = { a: 'A', b: 'B', c: 'C', 'الف': 'A', 'ب': 'B', 'ج': 'C' };

/** Light cleanup for display text: trims, unifies Arabic ي/ك so segments group correctly. */
function cleanText(value: string | undefined, max = 200): string | null {
  const s = (value ?? '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

export function parseCustomersCsv(bytes: Uint8Array): ParsedCustomers | ParseFailure {
  const { text, encoding } = decodeCsvBytes(bytes);
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  const header = rows[0];
  if (!header) return { ok: false, error: 'empty' };
  if (rows.length - 1 > MAX_IMPORT_ROWS) return { ok: false, error: 'too_many_rows' };

  const columns = header.cells.map((h) => ({ header: h.trim(), field: HEADER_LOOKUP.get(headerKey(h)) ?? null }));
  const index = new Map<CustomerField, number>();
  columns.forEach((c, i) => {
    if (c.field && !index.has(c.field)) index.set(c.field, i);
  });
  if (!index.has('mobile')) return { ok: false, error: 'no_mobile_column' };

  const records: ParsedCustomers['records'] = [];
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const seen = new Map<string, number>();

  for (const row of rows.slice(1)) {
    const cell = (field: CustomerField) => {
      const i = index.get(field);
      return i === undefined ? undefined : row.cells[i];
    };
    const rawMobile = (cell('mobile') ?? '').trim();
    if (!rawMobile) {
      errors.push({ line: row.line, code: 'mobile_missing' });
      continue;
    }
    const mobile = normalizeMobile(rawMobile);
    if (!mobile) {
      errors.push({ line: row.line, code: 'mobile_invalid', value: rawMobile.slice(0, 40) });
      continue;
    }
    const firstLine = seen.get(mobile);
    if (firstLine !== undefined) {
      errors.push({ line: row.line, code: 'duplicate_in_file', value: mobile, firstLine });
      continue;
    }
    seen.set(mobile, row.line);

    const rawTier = cleanText(cell('value_tier'), 10);
    const tier = rawTier ? (TIERS[rawTier.toLowerCase()] ?? null) : null;
    if (rawTier && !tier) warnings.push({ line: row.line, code: 'tier_invalid', value: rawTier });

    records.push({
      line: row.line,
      mobile,
      name: cleanText(cell('name')),
      company: cleanText(cell('company')),
      city: cleanText(cell('city'), 80),
      province: cleanText(cell('province'), 80),
      customer_type: cleanText(cell('customer_type'), 80),
      value_tier: tier,
      sales_rep: cleanText(cell('sales_rep'), 40),
      first_purchase_date: cleanText(cell('first_purchase_date'), 40),
    });
  }

  return { ok: true, encoding, delimiter, columns, totalRows: rows.length - 1, records, errors, warnings };
}

