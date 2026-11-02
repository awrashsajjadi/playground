// Survey submission: window → rate limit → honeypot → token/timing → validation → duplicate → save → alert.
import { surveyState, type SurveyConfig } from '../config.ts';
import { ipHash } from '../core/crypto.ts';
import { normalizeMobile } from '../core/mobile.ts';
import { categorize, isValidScore, type Category } from '../core/nps.ts';
import { tagThemes } from '../core/themes.ts';
import type { AppContext } from '../context.ts';
import { readFormToken } from './tokens.ts';

export const MIN_FILL_MS = 3000;

export type FieldErrors = Partial<Record<'score' | 'mobile' | 'comment', string>>;

/** Raw values echoed back into the no-JS form after an error. */
export interface FormValues {
  score: string;
  drivers: string[];
  comment: string;
  mobile: string;
  contact: boolean;
}

export interface ValidSubmission {
  score: number;
  drivers: string[];
  comment: string | null;
  mobile: string;
  contact: boolean;
  src: string;
  rep: string | null;
}

export type SubmitOutcome =
  | { kind: 'created'; id: number; category: Category; test: boolean }
  | { kind: 'duplicate' }
  | { kind: 'not_open' }
  | { kind: 'closed' }
  | { kind: 'rate_limited'; retryAfterSec: number }
  | { kind: 'rejected' }
  | { kind: 'bad_token' }
  | { kind: 'too_fast'; values: FormValues }
  | { kind: 'invalid'; errors: FieldErrors; values: FormValues };

export interface SubmitInput {
  body: Record<string, unknown>;
  /** json = fetch from our JS; form = classic POST without JS (all values are strings). */
  mode: 'json' | 'form';
  ip: string;
  userAgent: string | undefined;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

export function pickChannel(value: unknown, channels: Record<string, string>): string {
  const src = asString(value).trim().toLowerCase();
  return src && Object.hasOwn(channels, src) ? src : 'direct';
}

/** Rep codes: short, printable, no markup. Anything else is dropped rather than rejected. */
export function cleanRep(value: unknown): string | null {
  const rep = asString(value)
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 40);
  return rep || null;
}

export function cleanComment(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formValues(body: Record<string, unknown>): FormValues {
  const drivers = Array.isArray(body.drivers) ? body.drivers : body.drivers === undefined ? [] : [body.drivers];
  return {
    score: typeof body.score === 'number' ? String(body.score) : asString(body.score),
    drivers: drivers.filter((d): d is string => typeof d === 'string'),
    comment: asString(body.comment).slice(0, 5000),
    mobile: asString(body.mobile).slice(0, 40),
    contact: isChecked(body.contact),
  };
}

function isChecked(v: unknown): boolean {
  return v === true || v === 'on' || v === '1' || v === 'true';
}

export function validateFields(
  body: Record<string, unknown>,
  mode: 'json' | 'form',
  survey: SurveyConfig,
): { ok: true; value: ValidSubmission } | { ok: false; errors: FieldErrors; values: FormValues } {
  const values = formValues(body);
  const errors: FieldErrors = {};

  let score: number | null = null;
  if (mode === 'json') {
    if (isValidScore(body.score)) score = body.score;
  } else if (/^(10|[0-9])$/.test(asString(body.score).trim())) {
    score = Number(asString(body.score).trim());
  }
  if (score === null) errors.score = 'score_invalid';

  let comment: string | null = null;
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== 'string') errors.comment = 'comment_invalid';
    else {
      const cleaned = cleanComment(body.comment);
      if ([...cleaned].length > survey.step2.commentMaxLength) errors.comment = 'comment_too_long';
      else comment = cleaned || null;
    }
  }

  const mobile = normalizeMobile(body.mobile);
  if (!mobile) errors.mobile = 'mobile_invalid';

  if (score === null || !mobile || errors.comment) return { ok: false, errors, values };

  // Known driver ids only, de-duplicated, in config order.
  const drivers = survey.drivers.map((d) => d.id).filter((id) => values.drivers.includes(id));
  return {
    ok: true,
    value: {
      score,
      drivers,
      comment,
      mobile,
      contact: score <= 8 && values.contact,
      src: pickChannel(body.src, survey.channels),
      rep: cleanRep(body.rep),
    },
  };
}

export function submitResponse(ctx: AppContext, input: SubmitInput): SubmitOutcome {
  const { config, repo } = ctx;
  const now = ctx.now();
  const nowMs = now.getTime();

  const token = readFormToken(config.sessionSecret, input.body.tk);
  const test = token?.test === true;
  if (!test) {
    const state = surveyState(now, config);
    if (state !== 'open') return { kind: state };
  }

  const ipKey = ipHash(config.sessionSecret, input.ip);
  const limit = ctx.submitLimiter.hit(ipKey, nowMs);
  if (!limit.ok) return { kind: 'rate_limited', retryAfterSec: limit.retryAfterSec };

  if (asString(input.body.website).trim() !== '') return { kind: 'rejected' };
  if (!token) return { kind: 'bad_token' };
  if (nowMs - token.issuedAt < MIN_FILL_MS) return { kind: 'too_fast', values: formValues(input.body) };

  const checked = validateFields(input.body, input.mode, config.survey);
  if (!checked.ok) return { kind: 'invalid', errors: checked.errors, values: checked.values };
  const v = checked.value;

  const category = categorize(v.score);
  const kind = test ? 'test' : 'live';
  const createdAt = now.toISOString();

  const saved = repo.transaction(() => {
    if (kind === 'live' && repo.hasLiveResponse(v.mobile)) {
      repo.insertDuplicate(v.mobile, v.score, createdAt);
      return null;
    }
    const customer = repo.findCustomerByMobile(v.mobile) ?? null;
    const id = repo.insertResponse({
      mobile: v.mobile,
      customer_id: customer?.id ?? null,
      score: v.score,
      category,
      drivers: JSON.stringify(v.drivers),
      comment: v.comment,
      contact_ok: v.contact ? 1 : 0,
      src: v.src,
      rep: v.rep,
      duration_ms: Math.max(0, Math.min(nowMs - token.issuedAt, 86_400_000)),
      ip_hash: ipKey,
      user_agent: input.userAgent?.slice(0, 300) ?? null,
      created_at: createdAt,
      followup_status: category === 'detractor' ? 'todo' : 'none',
      theme_tags: JSON.stringify(tagThemes(v.comment, ctx.themes)),
      kind,
    });
    if (kind === 'live') repo.insertEvent(token.sid, 'submitted', v.src, createdAt);
    return { id, customer };
  });

  if (!saved) return { kind: 'duplicate' };

  if (v.score <= 6) {
    const labels = new Map(config.survey.drivers.map((d) => [d.id, d.label]));
    ctx.notifier.detractor({
      score: v.score,
      name: saved.customer?.name ?? null,
      company: saved.customer?.company ?? null,
      comment: v.comment,
      drivers: v.drivers.map((id) => labels.get(id) ?? id),
      contactOk: v.contact,
      channel: config.survey.channels[v.src] ?? v.src,
      test,
    });
  }
  return { kind: 'created', id: saved.id, category, test };
}
