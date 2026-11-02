import { describe, expect, it, vi } from 'vitest';
import { createNotifier, formatAlert, type DetractorAlert } from '../../src/services/notify.ts';

const alert: DetractorAlert = {
  score: 3,
  name: 'رضا',
  company: 'پخش رضا',
  comment: 'ارسال دیر رسید',
  drivers: ['ارسال و تحویل به‌موقع'],
  contactOk: true,
  channel: 'پیامک',
  test: false,
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('detractor alert', () => {
  it('formats a short Persian message without the mobile number', () => {
    const text = formatAlert(alert, 'https://nazar.example.com/admin');
    expect(text).toBe(
      [
        '🔴 مشتری ناراضی: امتیاز ۳ از ۱۰',
        'مشتری: رضا — پخش رضا',
        'موضوع: ارسال و تحویل به‌موقع',
        'نظر: «ارسال دیر رسید»',
        'اجازه‌ی تماس: دارد ✅',
        'کانال: پیامک',
        'پیگیری: https://nazar.example.com/admin',
      ].join('\n'),
    );
    expect(formatAlert({ ...alert, test: true, name: null, company: null, comment: null, drivers: [] }, 'u')).toContain(
      '🧪 آزمایشی — ',
    );
  });

  it('posts {chat_id, text} to the Bale Bot API, moving chat_id out of the query string', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const n = createNotifier({
      url: 'https://tapi.bale.ai/bot123:ABC/sendMessage?chat_id=-1009',
      adminUrl: 'https://x/admin',
      log: { warn: vi.fn() },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    n.detractor(alert);
    await flush();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://tapi.bale.ai/bot123:ABC/sendMessage');
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: '-1009', text: expect.stringContaining('امتیاز ۳') });
  });

  it('never throws and only logs when the webhook fails or times out', async () => {
    const warn = vi.fn();
    const failing = createNotifier({
      url: 'https://example.invalid/hook',
      adminUrl: 'x',
      log: { warn },
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });
    expect(() => failing.detractor(alert)).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalledWith({ err: 'Error: network down' }, 'detractor webhook failed');

    const slow = createNotifier({
      url: 'https://example.invalid/hook',
      adminUrl: 'x',
      log: { warn },
      timeoutMs: 20,
      fetchImpl: ((_u: unknown, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch,
    });
    slow.detractor(alert);
    await new Promise((r) => setTimeout(r, 60));
    expect(warn).toHaveBeenLastCalledWith({ err: 'Error: aborted' }, 'detractor webhook failed');
  });

  it('is a no-op without a URL', () => {
    expect(() => createNotifier({ url: null, adminUrl: 'x', log: { warn: vi.fn() } }).detractor(alert)).not.toThrow();
  });
});
