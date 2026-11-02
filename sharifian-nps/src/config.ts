// Environment + JSON config loading with clear, all-at-once validation errors.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tehranDayKey } from './core/date.ts';
import type { ThemeDef } from './core/themes.ts';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface DriverDef {
  id: string;
  label: string;
}

export interface SurveyConfig {
  brand: { name: string; shopUrl: string; accent: string };
  meta: { title: string; description: string };
  intro: string;
  step1: { question: string; lowLabel: string; highLabel: string };
  step2: {
    titles: { promoter: string; passive: string; detractor: string; fallback: string };
    hint: string;
    commentLabel: string;
    commentPlaceholder: string;
    commentMaxLength: number;
  };
  drivers: DriverDef[];
  step3: {
    label: string;
    placeholder: string;
    contactConsent: string;
    contactConsentNoJs: string;
    privacy: string;
    submit: string;
    submitting: string;
  };
  buttons: { next: string; prev: string };
  thanks: { title: string; text: string; shopButton: string };
  states: {
    notOpenTitle: string; notOpen: string;
    closedTitle: string; closed: string;
    duplicateTitle: string; duplicate: string;
    errorTitle: string; error: string;
    rateLimited: string; notFound: string;
  };
  errors: { score: string; mobile: string; comment: string; tooFast: string; network: string };
  testBanner: string;
  /** src code → Persian label. Must contain "direct". */
  channels: Record<string, string>;
  /** Optional rep code → display name. */
  reps: Record<string, string>;
}

export type AppEnv = 'production' | 'development' | 'test';

export interface AppConfig {
  env: AppEnv;
  port: number;
  host: string;
  databasePath: string;
  adminPassword: string;
  sessionSecret: string;
  opensAt: Date;
  closesAt: Date;
  publicBaseUrl: string;
  webhookUrl: string | null;
  rateLimitPerHour: number;
  trustProxy: boolean | number | string;
  configDir: string;
  backupDir: string;
  survey: SurveyConfig;
  themes: ThemeDef[];
  warnings: string[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const REQUIRED_TEXTS = [
  'brand.name', 'brand.shopUrl', 'brand.accent', 'meta.title', 'meta.description', 'intro',
  'step1.question', 'step1.lowLabel', 'step1.highLabel',
  'step2.titles.promoter', 'step2.titles.passive', 'step2.titles.detractor', 'step2.titles.fallback',
  'step2.hint', 'step2.commentLabel', 'step2.commentPlaceholder',
  'step3.label', 'step3.placeholder', 'step3.contactConsent', 'step3.contactConsentNoJs',
  'step3.privacy', 'step3.submit', 'step3.submitting',
  'buttons.next', 'buttons.prev', 'thanks.title', 'thanks.text', 'thanks.shopButton',
  'states.notOpenTitle', 'states.notOpen', 'states.closedTitle', 'states.closed',
  'states.duplicateTitle', 'states.duplicate', 'states.errorTitle', 'states.error',
  'states.rateLimited', 'states.notFound',
  'errors.score', 'errors.mobile', 'errors.comment', 'errors.tooFast', 'errors.network', 'testBanner',
];

function readJson(path: string, errors: string[]): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    errors.push(`خواندن ${path} ممکن نشد: ${(err as Error).message}`);
    return null;
  }
}

function pathValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (cur, key) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

function isStringMap(v: unknown): v is Record<string, string> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
}

export function validateSurveyConfig(raw: unknown, errors: string[], file = 'survey.fa.json'): SurveyConfig | null {
  if (!raw || typeof raw !== 'object') {
    errors.push(`${file}: باید یک شیء JSON باشد.`);
    return null;
  }
  for (const path of REQUIRED_TEXTS) {
    const v = pathValue(raw, path);
    if (typeof v !== 'string' || v.trim() === '') errors.push(`${file}: متن «${path}» خالی است یا وجود ندارد.`);
  }
  const max = pathValue(raw, 'step2.commentMaxLength');
  if (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 5000) {
    errors.push(`${file}: step2.commentMaxLength باید عدد صحیح ۱ تا ۵۰۰۰ باشد.`);
  }
  const drivers = (raw as { drivers?: unknown }).drivers;
  if (!Array.isArray(drivers) || drivers.length === 0) {
    errors.push(`${file}: drivers باید لیستی غیرخالی باشد.`);
  } else {
    const ids = new Set<string>();
    for (const d of drivers as { id?: unknown; label?: unknown }[]) {
      if (typeof d?.id !== 'string' || !/^[a-z0-9_]{1,32}$/.test(d.id)) errors.push(`${file}: شناسه‌ی چیپ «${String(d?.id)}» نامعتبر است (فقط a-z، 0-9 و _).`);
      else if (ids.has(d.id)) errors.push(`${file}: شناسه‌ی چیپ «${d.id}» تکراری است.`);
      else ids.add(d.id);
      if (typeof d?.label !== 'string' || !d.label.trim()) errors.push(`${file}: متن چیپ «${String(d?.id)}» خالی است.`);
    }
  }
  const channels = (raw as { channels?: unknown }).channels;
  if (!isStringMap(channels) || !('direct' in channels)) {
    errors.push(`${file}: channels باید شامل کانال direct باشد.`);
  } else {
    for (const code of Object.keys(channels)) {
      if (!/^[a-z0-9_]{1,16}$/.test(code)) errors.push(`${file}: کد کانال «${code}» نامعتبر است.`);
    }
  }
  const reps = (raw as { reps?: unknown }).reps;
  if (reps !== undefined && !isStringMap(reps)) errors.push(`${file}: reps باید نگاشت «کد ← نام» باشد.`);
  return errors.length ? null : ({ reps: {}, ...(raw as object) } as SurveyConfig);
}

export function validateThemes(raw: unknown, errors: string[], file = 'themes.json'): ThemeDef[] {
  const themes = (raw as { themes?: unknown } | null)?.themes;
  if (!Array.isArray(themes)) {
    errors.push(`${file}: کلید themes باید لیست باشد.`);
    return [];
  }
  const list = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  themes.forEach((t: Partial<ThemeDef>, i: number) => {
    if (typeof t?.id !== 'string' || !/^[a-z0-9_]{1,32}$/.test(t.id)) errors.push(`${file}: شناسه‌ی موضوع شماره‌ی ${i + 1} نامعتبر است.`);
    if (typeof t?.label !== 'string' || !t.label.trim()) errors.push(`${file}: موضوع «${String(t?.id)}» برچسب ندارد.`);
    if (!list(t?.keywords)) errors.push(`${file}: keywords موضوع «${String(t?.id)}» باید لیست متن باشد.`);
    if (t?.exact !== undefined && !list(t.exact)) errors.push(`${file}: exact موضوع «${String(t?.id)}» باید لیست متن باشد.`);
    if (t?.exclude !== undefined && !list(t.exclude)) errors.push(`${file}: exclude موضوع «${String(t?.id)}» باید لیست متن باشد.`);
  });
  return themes as ThemeDef[];
}

export function loadSurveyFiles(configDir: string): { survey: SurveyConfig; themes: ThemeDef[] } {
  const errors: string[] = [];
  const survey = validateSurveyConfig(readJson(resolve(configDir, 'survey.fa.json'), errors), errors);
  const themes = validateThemes(readJson(resolve(configDir, 'themes.json'), errors), errors);
  if (errors.length || !survey) throw new ConfigError(`تنظیمات نامعتبر:\n- ${errors.join('\n- ')}`);
  return { survey, themes };
}

function parseInstant(value: string | undefined, name: string, errors: string[]): Date | null {
  if (!value?.trim()) return null;
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) {
    errors.push(`${name} تاریخ معتبری نیست (نمونه: 2026-11-08T08:00:00+03:30).`);
    return null;
  }
  return date;
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  const v = (value ?? 'true').trim().toLowerCase();
  if (v === 'true' || v === '') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return value!.trim();
}

/**
 * Loads `.env` from the project root when there is one (D89). Variables already set in the environment win,
 * so on Liara / Docker the platform's values are never overridden by a stray file.
 */
export function loadDotEnv(file = resolve(ROOT_DIR, '.env')): boolean {
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

/** Reads process.env (or a given env) and the JSON files. Throws ConfigError listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, nowMs = Date.now()): AppConfig {
  const errors: string[] = [];
  const warnings: string[] = [];
  const appEnv: AppEnv = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const prod = appEnv === 'production';

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) errors.push('PORT نامعتبر است.');

  const databasePath = env.DATABASE_PATH?.trim() || (prod ? '/data/nps.db' : resolve(ROOT_DIR, 'data/nps.db'));

  let adminPassword = env.ADMIN_PASSWORD ?? '';
  if (!adminPassword) {
    if (prod) errors.push('ADMIN_PASSWORD تنظیم نشده است.');
    else {
      adminPassword = 'admin';
      warnings.push('ADMIN_PASSWORD تنظیم نشده؛ در حالت توسعه رمز «admin» است.');
    }
  } else if (adminPassword.length < 12) {
    warnings.push('ADMIN_PASSWORD کوتاه است؛ حداقل ۱۲ نویسه پیشنهاد می‌شود.');
  }

  let sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    if (prod) errors.push('SESSION_SECRET باید حداقل ۳۲ نویسه باشد.');
    else {
      sessionSecret = randomBytes(32).toString('hex');
      warnings.push('SESSION_SECRET تنظیم نشده؛ مقدار موقت ساخته شد و با هر ری‌استارت سشن‌ها باطل می‌شوند.');
    }
  }

  let opensAt = parseInstant(env.SURVEY_OPENS_AT, 'SURVEY_OPENS_AT', errors);
  let closesAt = parseInstant(env.SURVEY_CLOSES_AT, 'SURVEY_CLOSES_AT', errors);
  if (!opensAt || !closesAt) {
    if (prod) {
      if (!env.SURVEY_OPENS_AT) errors.push('SURVEY_OPENS_AT تنظیم نشده است.');
      if (!env.SURVEY_CLOSES_AT) errors.push('SURVEY_CLOSES_AT تنظیم نشده است.');
    } else {
      // A campaign that is already running (D87): opened 5 days ago at 08:00 Tehran and closes in 2 days, so the
      // form is open and seed:demo data lands in the past, as it would mid-campaign.
      const day = 24 * 3600_000;
      opensAt ??= new Date(`${tehranDayKey(new Date(nowMs - 5 * day))}T08:00:00+03:30`);
      closesAt ??= new Date(`${tehranDayKey(new Date(nowMs + 2 * day))}T23:59:59+03:30`);
      warnings.push('بازه‌ی نظرسنجی تنظیم نشده؛ در حالت توسعه از ۵ روز پیش تا ۲ روز بعد باز است.');
    }
  }
  if (opensAt && closesAt && opensAt >= closesAt) errors.push('SURVEY_OPENS_AT باید قبل از SURVEY_CLOSES_AT باشد.');

  const publicBaseUrl = (env.PUBLIC_BASE_URL?.trim() || (prod ? '' : `http://localhost:${port}`)).replace(/\/+$/, '');
  if (!publicBaseUrl) errors.push('PUBLIC_BASE_URL تنظیم نشده است.');
  else if (!/^https?:\/\/[^/\s]+$/.test(publicBaseUrl)) errors.push('PUBLIC_BASE_URL باید فقط دامنه باشد، مثل https://nazar.sharifianshop.com');

  const webhookUrl = env.DETRACTOR_WEBHOOK_URL?.trim() || null;
  if (webhookUrl && !/^https?:\/\//.test(webhookUrl)) errors.push('DETRACTOR_WEBHOOK_URL باید با http یا https شروع شود.');

  const rateLimitPerHour = Number(env.RATE_LIMIT_PER_HOUR ?? 10);
  if (!Number.isInteger(rateLimitPerHour) || rateLimitPerHour < 0) errors.push('RATE_LIMIT_PER_HOUR باید عدد صحیح ۰ یا بیشتر باشد.');

  const configDirRaw = env.CONFIG_DIR?.trim() || 'config';
  const configDir = isAbsolute(configDirRaw) ? configDirRaw : resolve(ROOT_DIR, configDirRaw);
  const backupDir = env.BACKUP_DIR?.trim() || resolve(dirname(databasePath === ':memory:' ? resolve(ROOT_DIR, 'data/x') : databasePath), 'backups');

  let files: { survey: SurveyConfig; themes: ThemeDef[] } | null = null;
  try {
    files = loadSurveyFiles(configDir);
  } catch (err) {
    errors.push((err as Error).message);
  }

  if (errors.length || !files || !opensAt || !closesAt) {
    throw new ConfigError(`پیکربندی نامعتبر است:\n- ${errors.join('\n- ')}`);
  }

  return {
    env: appEnv,
    port,
    host: env.HOST?.trim() || '0.0.0.0',
    databasePath,
    adminPassword,
    sessionSecret,
    opensAt,
    closesAt,
    publicBaseUrl,
    webhookUrl,
    rateLimitPerHour,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    configDir,
    backupDir,
    survey: files.survey,
    themes: files.themes,
    warnings,
  };
}

export type SurveyState = 'not_open' | 'open' | 'closed';

export function surveyState(now: Date, config: Pick<AppConfig, 'opensAt' | 'closesAt'>): SurveyState {
  if (now < config.opensAt) return 'not_open';
  if (now > config.closesAt) return 'closed';
  return 'open';
}
