// Instant detractor alert to a Bale (or Telegram) bot. Fire-and-forget: never blocks or breaks a submission.
import { faDigits } from '../core/fa.ts';

export interface DetractorAlert {
  score: number;
  name: string | null;
  company: string | null;
  comment: string | null;
  drivers: string[];
  contactOk: boolean;
  channel: string;
  test: boolean;
}

export interface Notifier {
  detractor(alert: DetractorAlert): void;
}

interface Logger {
  warn(obj: object, msg: string): void;
}

export const noopNotifier: Notifier = { detractor() {} };

export function formatAlert(alert: DetractorAlert, adminUrl: string): string {
  const who = [alert.name, alert.company].filter(Boolean).join(' — ');
  const comment = alert.comment && alert.comment.length > 500 ? `${alert.comment.slice(0, 500)}…` : alert.comment;
  return [
    `${alert.test ? '🧪 آزمایشی — ' : ''}🔴 مشتری ناراضی: امتیاز ${faDigits(alert.score)} از ۱۰`,
    `مشتری: ${who || 'در لیست مشتریان پیدا نشد'}`,
    alert.drivers.length ? `موضوع: ${alert.drivers.join('، ')}` : null,
    comment ? `نظر: «${comment}»` : null,
    `اجازه‌ی تماس: ${alert.contactOk ? 'دارد ✅' : 'ندارد'}`,
    `کانال: ${alert.channel}`,
    `پیگیری: ${adminUrl}`,
  ].filter((line): line is string => line !== null).join('\n');
}

/**
 * DETRACTOR_WEBHOOK_URL = https://tapi.bale.ai/bot<TOKEN>/sendMessage?chat_id=<ID>
 * chat_id moves from the query string into the JSON body (works for Bale and Telegram).
 * Without chat_id the URL is treated as a generic JSON webhook.
 */
export function createNotifier(options: {
  url: string | null;
  adminUrl: string;
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Notifier {
  if (!options.url) return noopNotifier;
  const target = new URL(options.url);
  const chatId = target.searchParams.get('chat_id');
  target.searchParams.delete('chat_id');
  const doFetch = options.fetchImpl ?? fetch;

  return {
    detractor(alert) {
      const text = formatAlert(alert, options.adminUrl);
      const body = chatId ? { chat_id: chatId, text } : { text, ...alert };
      doFetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
      })
        .then((res) => {
          if (!res.ok) options.log.warn({ status: res.status }, 'detractor webhook rejected');
        })
        .catch((err: unknown) => options.log.warn({ err: String(err) }, 'detractor webhook failed'));
    },
  };
}
