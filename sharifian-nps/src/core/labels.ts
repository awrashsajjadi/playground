// Persian labels for admin screens and exports (survey-facing texts live in config/survey.fa.json).
import type { Category } from './nps.ts';

export const CATEGORY_LABELS: Record<Category, string> = {
  promoter: 'مروج',
  passive: 'خنثی',
  detractor: 'منتقد',
};

export const FOLLOWUP_LABELS: Record<string, string> = {
  none: '—',
  todo: 'در انتظار تماس',
  called: 'تماس گرفته شد',
  resolved: 'حل شد',
  unreachable: 'پاسخ نداد',
};

export const KIND_LABELS: Record<string, string> = {
  live: 'واقعی',
  demo: 'نمایشی',
  test: 'آزمایشی',
};

/** "۵ روز و ۳ ساعت" — coarse countdown text for the admin home. */
export function faDuration(ms: number, digits: (n: number) => string): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${digits(days)} روز و ${digits(hours)} ساعت` : `${digits(days)} روز`;
  if (hours > 0) return mins > 0 ? `${digits(hours)} ساعت و ${digits(mins)} دقیقه` : `${digits(hours)} ساعت`;
  return `${digits(Math.max(1, mins))} دقیقه`;
}
