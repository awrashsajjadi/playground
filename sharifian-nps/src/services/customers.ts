// Customer list import: preview (no writes) and commit (upsert by mobile + re-match responses).
import {
  parseCustomersCsv, type CustomerRecord, type ImportIssue, type ParseFailure, type ParsedCustomers,
} from '../core/customers-csv.ts';
import { faDigits } from '../core/fa.ts';
import type { AppContext } from '../context.ts';

const ISSUE_TEXT: Record<ImportIssue['code'], string> = {
  mobile_missing: 'شماره موبایل خالی است',
  mobile_invalid: 'شماره موبایل نامعتبر است',
  duplicate_in_file: 'شماره در فایل تکراری است',
  tier_invalid: 'سطح باید A، B یا C باشد؛ خالی ذخیره می‌شود',
};

const FAILURE_TEXT: Record<ParseFailure['error'], string> = {
  empty: 'فایل خالی است.',
  no_mobile_column: 'ستون موبایل در سطر اول پیدا نشد. نام ستون باید mobile (یا «موبایل») باشد.',
  too_many_rows: 'فایل بیش از ۲۰٬۰۰۰ ردیف دارد.',
};

const ENCODING_TEXT: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 (با BOM)',
  'utf-16le': 'UTF-16 (Unicode Text اکسل)',
  'utf-16be': 'UTF-16',
  'windows-1256': 'Windows-1256 (CSV معمولی اکسل فارسی)',
};

const DELIMITER_TEXT: Record<string, string> = { ',': 'ویرگول ,', ';': 'نقطه‌ویرگول ;', '\t': 'تب', '؛': 'نقطه‌ویرگول فارسی ؛' };

export interface IssueView extends ImportIssue {
  message: string;
}

export type ImportFailure = { ok: false; error: string; message: string };

function describe(issue: ImportIssue): IssueView {
  const extra =
    issue.code === 'duplicate_in_file' && issue.firstLine ? ` (اولین بار در سطر ${faDigits(issue.firstLine)})` : '';
  const value = issue.value ? `: ${issue.value}` : '';
  return { ...issue, message: `سطر ${faDigits(issue.line)} — ${ISSUE_TEXT[issue.code]}${value}${extra}` };
}

function parse(bytes: Buffer): ParsedCustomers | ImportFailure {
  const parsed = parseCustomersCsv(bytes);
  return parsed.ok ? parsed : { ok: false, error: parsed.error, message: FAILURE_TEXT[parsed.error] };
}

export function previewImport(ctx: AppContext, bytes: Buffer) {
  const parsed = parse(bytes);
  if (!parsed.ok) return parsed;
  const existing = ctx.repo.customerMobiles();
  const updateCount = parsed.records.filter((r) => existing.has(r.mobile)).length;
  return {
    ok: true as const,
    encoding: ENCODING_TEXT[parsed.encoding] ?? parsed.encoding,
    delimiter: DELIMITER_TEXT[parsed.delimiter] ?? parsed.delimiter,
    columns: parsed.columns,
    totalRows: parsed.totalRows,
    validRows: parsed.records.length,
    newCount: parsed.records.length - updateCount,
    updateCount,
    errorCount: parsed.errors.length,
    warningCount: parsed.warnings.length,
    errors: parsed.errors.slice(0, 50).map(describe),
    warnings: parsed.warnings.slice(0, 50).map(describe),
    preview: parsed.records.slice(0, 10).map(({ line: _line, ...record }): CustomerRecord => record),
  };
}

export function commitImport(ctx: AppContext, bytes: Buffer) {
  const parsed = parse(bytes);
  if (!parsed.ok) return parsed;
  const existing = ctx.repo.customerMobiles();
  const importedAt = ctx.now().toISOString();
  let inserted = 0;
  let updated = 0;
  ctx.repo.transaction(() => {
    for (const { line: _line, ...record } of parsed.records) {
      ctx.repo.upsertCustomer(record, importedAt);
      if (existing.has(record.mobile)) updated++;
      else inserted++;
    }
  });
  const match = ctx.repo.rematchAll();
  return {
    ok: true as const,
    inserted,
    updated,
    skipped: parsed.errors.length,
    matched: match.matched,
    unmatched: match.unmatched,
  };
}

export const SAMPLE_CSV =
  'mobile,name,company,city,province,customer_type,value_tier,sales_rep,first_purchase_date\r\n' +
  '09121234567,علی رضایی,عطاری رضایی,تهران,تهران,عطاری,A,r01,1401/05/12\r\n' +
  '09351234567,مریم احمدی,سوپرمارکت ستاره,مشهد,خراسان رضوی,سوپرمارکت,B,r02,1402/11/03\r\n';
