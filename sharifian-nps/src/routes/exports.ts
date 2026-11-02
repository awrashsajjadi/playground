// CSV exports (UTF-8 + BOM for Persian Excel): all responses, non-respondents, detractor follow-ups.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { toCsv, type CsvValue } from '../core/csv.ts';
import { shamsiDateTimeAscii, shamsiStamp } from '../core/date.ts';
import { CATEGORY_LABELS, FOLLOWUP_LABELS, KIND_LABELS } from '../core/labels.ts';
import type { AppContext } from '../context.ts';
import type { ResponseRow } from '../db/repo.ts';
import { requireAdmin } from '../plugins/auth.ts';
import { surveyLink } from './admin.ts';

const OVERDUE_MS = 48 * 3600_000;

export function exportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, repo } = ctx;
  const guard = requireAdmin(config.sessionSecret);
  const driverLabels = new Map(config.survey.drivers.map((d) => [d.id, d.label]));
  const themeLabels = new Map(config.themes.map((t) => [t.id, t.label]));
  const channel = (src: string) => config.survey.channels[src] ?? src;
  const labels = (json: string, map: Map<string, string>) =>
    (JSON.parse(json) as string[]).map((id) => map.get(id) ?? id).join('، ');
  const yesNo = (v: number) => (v ? 'بله' : 'خیر');

  const send = (reply: FastifyReply, name: string, rows: CsvValue[][]) => {
    const stats = repo.stats();
    const demo = stats.demo + stats.demo_customers > 0 ? 'DEMO-' : '';
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${demo}sharifian-nps-${name}-${shamsiStamp(ctx.now())}.csv"`)
      .header('cache-control', 'no-store')
      .send(toCsv(rows));
  };

  app.get('/admin/export/responses.csv', { preHandler: guard }, async (_req, reply) => {
    const header = [
      'شناسه', 'تاریخ و ساعت (شمسی، تهران)', 'زمان UTC', 'موبایل', 'امتیاز', 'دسته', 'عوامل', 'نظر', 'موضوع‌های متن',
      'اجازه‌ی تماس', 'کانال', 'کد کارشناس لینک', 'نام', 'شرکت', 'شهر', 'استان', 'نوع مشتری', 'سطح', 'کارشناس فروش',
      'وضعیت پیگیری', 'یادداشت پیگیری', 'پیگیری‌کننده', 'زمان پیگیری', 'مدت تکمیل (ثانیه)', 'نوع داده',
    ];
    const rows = repo.responsesForExport().map((r: ResponseRow): CsvValue[] => [
      r.id, shamsiDateTimeAscii(r.created_at), r.created_at, r.mobile, r.score, CATEGORY_LABELS[r.category],
      labels(r.drivers, driverLabels), r.comment, labels(r.theme_tags, themeLabels), yesNo(r.contact_ok),
      channel(r.src), r.rep, r.name, r.company, r.city, r.province, r.customer_type, r.value_tier, r.sales_rep,
      FOLLOWUP_LABELS[r.followup_status], r.followup_note, r.followup_by,
      r.followup_at ? shamsiDateTimeAscii(r.followup_at) : null,
      r.duration_ms === null ? null : Math.round(r.duration_ms / 1000), KIND_LABELS[r.kind],
    ]);
    return send(reply, 'responses', [header, ...rows]);
  });

  app.get('/admin/export/non-respondents.csv', { preHandler: guard }, async (_req, reply) => {
    const header = ['موبایل', 'نام', 'شرکت', 'شهر', 'استان', 'نوع مشتری', 'سطح', 'کارشناس فروش', 'لینک شخصی (پیامک)', 'نوع داده'];
    const rows = repo.nonRespondents().map((c): CsvValue[] => [
      c.mobile, c.name, c.company, c.city, c.province, c.customer_type, c.value_tier, c.sales_rep,
      surveyLink(config.publicBaseUrl, 'sms', c.sales_rep), c.is_demo ? KIND_LABELS.demo : KIND_LABELS.live,
    ]);
    return send(reply, 'non-respondents', [header, ...rows]);
  });

  app.get('/admin/export/followups.csv', { preHandler: guard }, async (_req, reply) => {
    const now = ctx.now().getTime();
    const header = [
      'تاریخ و ساعت', 'نام', 'شرکت', 'موبایل', 'امتیاز', 'عوامل', 'نظر', 'اجازه‌ی تماس', 'سطح', 'کارشناس فروش',
      'وضعیت پیگیری', 'یادداشت', 'پیگیری‌کننده', 'زمان پیگیری', 'بیش از ۴۸ ساعت بدون پیگیری',
    ];
    const rows = repo.followups().map((r): CsvValue[] => [
      shamsiDateTimeAscii(r.created_at), r.name, r.company, r.mobile, r.score, labels(r.drivers, driverLabels),
      r.comment, yesNo(r.contact_ok), r.value_tier, r.sales_rep ?? r.rep, FOLLOWUP_LABELS[r.followup_status],
      r.followup_note, r.followup_by, r.followup_at ? shamsiDateTimeAscii(r.followup_at) : null,
      r.followup_status === 'todo' && now - Date.parse(r.created_at) > OVERDUE_MS ? 'بله' : 'خیر',
    ]);
    return send(reply, 'followups', [header, ...rows]);
  });
}
