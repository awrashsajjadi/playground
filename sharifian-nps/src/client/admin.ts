// Admin panel helpers: CSV import preview/commit, copy buttons, confirmation prompts.
import { faDigits } from '../core/fa.ts';

const csrf = (): string => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

interface Issue {
  message: string;
}

interface Preview {
  ok: boolean;
  message?: string;
  encoding: string;
  delimiter: string;
  columns: { header: string; field: string | null }[];
  totalRows: number;
  validRows: number;
  newCount: number;
  updateCount: number;
  errorCount: number;
  warningCount: number;
  errors: Issue[];
  warnings: Issue[];
  preview: Record<string, string | null>[];
}

interface CommitResult {
  ok: boolean;
  message?: string;
  inserted: number;
  updated: number;
  skipped: number;
  matched: number;
  unmatched: number;
}

const FIELDS: [string, string][] = [
  ['mobile', 'موبایل'], ['name', 'نام'], ['company', 'شرکت'], ['city', 'شهر'], ['province', 'استان'],
  ['customer_type', 'نوع'], ['value_tier', 'سطح'], ['sales_rep', 'کارشناس'], ['first_purchase_date', 'اولین خرید'],
];

async function upload(url: string, file: File): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf(), accept: 'application/json' },
    body: await file.arrayBuffer(),
  });
}

function summaryBox(items: [string, number][]): HTMLElement {
  const box = el('div', undefined, 'summary');
  // Index access instead of destructuring in for-of (esbuild cannot down-level that for old Safari).
  for (const pair of items) {
    const item = el('div');
    item.append(el('strong', faDigits(pair[1])), el('span', pair[0]));
    box.append(item);
  }
  return box;
}

function issueList(title: string, issues: Issue[], total: number, className: string): HTMLElement[] {
  if (!total) return [];
  const list = el('ul', undefined, `issues ${className}`);
  for (const issue of issues) list.append(el('li', issue.message));
  const more = total > issues.length ? ` (${faDigits(issues.length)} مورد اول از ${faDigits(total)})` : '';
  return [el('h3', `${title}${more}`), list];
}

function initImport(): void {
  const input = document.getElementById('csv-file') as HTMLInputElement | null;
  const previewBtn = document.getElementById('csv-preview') as HTMLButtonElement | null;
  const result = document.getElementById('import-result');
  if (!input || !previewBtn || !result) return;

  const show = (...nodes: Node[]) => {
    result.replaceChildren(...nodes);
    result.hidden = false;
  };

  input.addEventListener('change', () => {
    previewBtn.disabled = !input.files?.length;
    result.hidden = true;
  });

  previewBtn.addEventListener('click', async () => {
    const file = input.files?.[0];
    if (!file) return;
    previewBtn.disabled = true;
    try {
      const res = await upload('/admin/import/preview', file);
      const data = (await res.json()) as Preview;
      if (!data.ok) {
        show(el('p', data.message ?? 'خطا در خواندن فایل.', 'banner banner-danger'));
        return;
      }
      const nodes: Node[] = [
        el('h2', 'پیش‌نمایش'),
        el('p', `کدگذاری: ${data.encoding} · جداکننده: ${data.delimiter}`, 'muted small'),
        summaryBox([
          ['ردیف در فایل', data.totalRows],
          ['ردیف سالم', data.validRows],
          ['مشتری جدید', data.newCount],
          ['به‌روزرسانی', data.updateCount],
          ['خطا (وارد نمی‌شود)', data.errorCount],
        ]),
      ];
      const unknown = data.columns.filter((c) => !c.field).map((c) => c.header).filter(Boolean);
      if (unknown.length) nodes.push(el('p', `ستون‌های ناشناخته (نادیده گرفته می‌شوند): ${unknown.join('، ')}`, 'muted small'));
      nodes.push(...issueList('خطاها', data.errors, data.errorCount, 'errors'));
      nodes.push(...issueList('هشدارها', data.warnings, data.warningCount, ''));

      if (data.preview.length) {
        const table = el('table');
        const head = el('tr');
        for (const f of FIELDS) head.append(el('th', f[1]));
        table.append(head);
        for (const row of data.preview) {
          const tr = el('tr');
          for (const f of FIELDS) {
            const key = f[0];
            const td = el('td', row[key] ?? '—');
            if (key === 'mobile') td.className = 'ltr';
            tr.append(td);
          }
          table.append(tr);
        }
        const wrap = el('div', undefined, 'table-wrap');
        wrap.append(table);
        nodes.push(el('h3', `${faDigits(data.preview.length)} ردیف اول`), wrap);
      }

      if (data.validRows > 0) {
        const commit = el('button', `تأیید و ورود ${faDigits(data.validRows)} مشتری`, 'btn');
        commit.type = 'button';
        commit.addEventListener('click', async () => {
          commit.disabled = true;
          commit.textContent = 'در حال ورود…';
          try {
            const r = await upload('/admin/import/commit', file);
            const done = (await r.json()) as CommitResult;
            if (!done.ok) {
              show(el('p', done.message ?? 'ورود انجام نشد.', 'banner banner-danger'));
              return;
            }
            show(
              el('p', 'لیست مشتریان با موفقیت وارد شد و پاسخ‌ها دوباره مچ شدند.', 'banner banner-ok'),
              summaryBox([
                ['مشتری جدید', done.inserted],
                ['به‌روزرسانی', done.updated],
                ['ردیف رد شده', done.skipped],
                ['پاسخ مچ‌شده', done.matched],
                ['پاسخ بدون مچ', done.unmatched],
              ]),
            );
          } catch {
            commit.disabled = false;
            commit.textContent = 'تلاش دوباره';
          }
        });
        nodes.push(commit);
      }
      show(...nodes);
    } catch {
      show(el('p', 'ارتباط با سرور برقرار نشد.', 'banner banner-danger'));
    } finally {
      previewBtn.disabled = false;
    }
  });
}

function initCopy(): void {
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
    if (!button) return;
    const text = button.getAttribute('data-copy') ?? '';
    const flash = () => {
      const original = button.textContent;
      button.textContent = 'کپی شد ✓';
      setTimeout(() => (button.textContent = original), 1500);
    };
    const fallback = () => {
      const input = button.parentElement?.querySelector<HTMLInputElement>('input');
      if (input) {
        input.select();
        if (document.execCommand('copy')) flash();
      }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(flash, fallback);
    else fallback();
  });
  document.addEventListener('focusin', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.classList?.contains('link-url')) target.select();
  });
}

function initConfirm(): void {
  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    const message = form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  });
}

initImport();
initCopy();
initConfirm();
