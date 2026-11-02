// Demo data for reviewing the dashboard before the campaign: 500 customers + 180 realistic responses.
// Every row is marked (customers.is_demo, responses.kind='demo', events 'demo-*') so seed:clear removes
// exactly these rows and nothing real. Deterministic (fixed PRNG seed) so screenshots are reproducible.
import { tehranDayKey } from '../core/date.ts';
import { categorize, type Category } from '../core/nps.ts';
import { compileThemes, tagThemes } from '../core/themes.ts';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db/db.ts';

export const DEMO_CUSTOMERS = 500;
export const DEMO_RESPONSES = 180;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES: [string, string, number][] = [
  ['تهران', 'تهران', 30], ['مشهد', 'خراسان رضوی', 12], ['اصفهان', 'اصفهان', 10], ['شیراز', 'فارس', 9],
  ['تبریز', 'آذربایجان شرقی', 8], ['کرج', 'البرز', 7], ['اهواز', 'خوزستان', 6], ['قم', 'قم', 5],
  ['رشت', 'گیلان', 5], ['کرمان', 'کرمان', 4], ['یزد', 'یزد', 2], ['ساری', 'مازندران', 2],
];
const TYPES: [string, number][] = [['عطاری', 35], ['سوپرمارکت', 28], ['رستوران', 14], ['پخش‌کننده', 8], ['قنادی', 8], ['کافه', 7]];
const TIERS: [string, number][] = [['A', 15], ['B', 35], ['C', 50]];
const REPS: [string, number][] = [['r01', 22], ['r02', 20], ['r03', 18], ['r04', 16], ['r05', 14], ['r06', 10]];
const CHANNELS: [string, number][] = [['sms', 40], ['wa', 25], ['call', 10], ['bale', 8], ['direct', 7], ['eitaa', 4], ['tg', 3], ['ig', 3]];
const FIRST = ['علی', 'محمد', 'حسین', 'رضا', 'مهدی', 'امیر', 'سعید', 'حمید', 'مجید', 'ناصر', 'جواد', 'حسن', 'عباس', 'مصطفی', 'یوسف', 'مریم', 'زهرا', 'فاطمه', 'سارا', 'نرگس', 'لیلا', 'الهام', 'مینا', 'شهلا'];
const LAST = ['رضایی', 'احمدی', 'محمدی', 'حسینی', 'کریمی', 'موسوی', 'جعفری', 'صادقی', 'رحیمی', 'نوری', 'اکبری', 'قاسمی', 'کاظمی', 'عباسی', 'حیدری', 'طاهری', 'سلیمانی', 'یزدانی', 'فرهادی', 'نظری'];
const SHOP_WORDS = ['ستاره', 'آفتاب', 'نگین', 'صبا', 'پارس', 'البرز', 'نوین', 'گلستان', 'ارغوان', 'سپید', 'مهر', 'آرش'];

const DRIVER_P: Record<Category, Record<string, number>> = {
  promoter: { quality: 0.7, sales_team: 0.45, variety: 0.35, packaging: 0.25, delivery: 0.25, price: 0.15, payment_terms: 0.15, online_ordering: 0.1 },
  passive: { price: 0.45, delivery: 0.4, variety: 0.3, online_ordering: 0.25, payment_terms: 0.2, quality: 0.2, packaging: 0.15, sales_team: 0.15 },
  detractor: { price: 0.55, delivery: 0.5, quality: 0.3, payment_terms: 0.3, sales_team: 0.25, online_ordering: 0.2, packaging: 0.2, variety: 0.15 },
};

const COMMENTS: Record<Category, string[]> = {
  promoter: [
    'کیفیت ادویه‌ها عالی است؛ زعفران و فلفل همیشه تازه و خوش‌رنگ می‌رسد.',
    'کارشناس فروش‌مان خیلی پیگیر و خوش‌برخورد است. ممنون از تیم شریفیان.',
    'تنوع محصول خوب است و بیشتر اقلام عطاری را یکجا پیدا می‌کنیم.',
    'بسته‌بندی تمیز و محکم است و مشتری‌های ما هم راضی‌اند.',
    'سال‌هاست از شریفیان خرید می‌کنیم؛ جنس اصل و قیمت منصفانه.',
    'ارسال سریع و به‌موقع، حتی در شلوغی‌های آخر سال.',
    'عطر و طعم ادویه‌ها با بقیه‌ی پخش‌کننده‌ها قابل مقایسه نیست.',
    'پاسخگویی تلفنی خوب است و مشکلات سریع حل می‌شود.',
    'سفارش آنلاین از سایت راحت است و فاکتور دقیق می‌آید.',
    'شرایط پرداخت چکی برای ما خیلی کمک‌کننده است.',
    'كيفيت جنس همیشه یکسان است و مشتری‌ها سراغش را می‌گیرند.',
    'عالی',
  ],
  passive: [
    'کیفیت خوب است ولی قیمت‌ها نسبت به بازار کمی بالاست.',
    'اگر ارسال به شهرستان سریع‌تر بود حتماً ۱۰ می‌دادم.',
    'بعضی اقلام مثل هل و دارچین گاهی موجود نیست.',
    'سایت گاهی کند است و ثبت سفارش آنلاین سخت می‌شود.',
    'کاش تخفیف حجمی برای خرید عمده بیشتر بود.',
    'در کل راضی هستیم؛ فقط زمان تحویل دقیق‌تر اعلام شود.',
    'شرایط پرداخت می‌توانست انعطاف بیشتری داشته باشد.',
    'بسته‌بندی بعضی محصولات برای فروش فله مناسب نیست.',
  ],
  detractor: [
    'سفارش آخر سه روز دیر رسید و چند مشتری را از دست دادم.',
    'قیمت‌ها هر ماه بالا می‌رود و دیگر به‌صرفه نیست.',
    'زردچوبه‌ی این دفعه رنگ و بوی همیشه را نداشت.',
    'چند بار تماس گرفتم و کسی جواب نداد.',
    'کسری در بار داشتیم و پیگیری مرجوعی خیلی طول کشید.',
    'کیسه‌ها پاره رسیده بود و نصف جنس ریخته بود.',
    'برای خرید مدت‌دار چک قبول نمی‌کنند؛ برای ما سخت است.',
    'ارسال به اهواز همیشه با تأخیر است.',
    'سایت مدام خطا می‌دهد و نتوانستم سفارش ثبت کنم.',
    'فلفل سیاه کهنه بود و مشتری برگرداند.',
    'برخورد کارشناس فروش مناسب نبود.',
    'پسته‌ها خوب بود ولی ادویه‌ها گران‌تر از رقبا است.',
  ],
};

const NOTES: Record<string, string[]> = {
  called: ['تماس گرفته شد؛ قرار شد بار بعدی با تخفیف ارسال شود.', 'مشکل ارسال به واحد لجستیک گزارش شد.', 'با مشتری صحبت شد؛ منتظر نمونه‌ی جدید است.'],
  resolved: ['کالای معیوب جایگزین شد و مشتری راضی بود.', 'شرایط پرداخت جدید پیشنهاد شد و پذیرفت.'],
  unreachable: ['دو بار تماس؛ پاسخ نداد.', 'خاموش بود؛ فردا دوباره تماس.'],
};
const STAFF = ['سارا', 'رضا', 'مدیر فروش'];
const UAS = [
  'Mozilla/5.0 (Linux; Android 12; SM-A325F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 10; Redmi Note 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36',
];

export function hasRealData(db: DB): boolean {
  const row = db
    .prepare("SELECT (SELECT COUNT(*) FROM responses WHERE kind = 'live') + (SELECT COUNT(*) FROM customers WHERE is_demo = 0) AS n")
    .get() as { n: number };
  return row.n > 0;
}

export function clearDemo(db: DB): { responses: number; customers: number; events: number } {
  return db.transaction(() => ({
    responses: db.prepare("DELETE FROM responses WHERE kind = 'demo'").run().changes,
    customers: db.prepare('DELETE FROM customers WHERE is_demo = 1').run().changes,
    events: db.prepare("DELETE FROM events WHERE session_id LIKE 'demo-%'").run().changes,
  }))();
}

export function seedDemo(db: DB, config: AppConfig, seed = 1405): { customers: number; responses: number; events: number } {
  const rand = mulberry32(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const weighted = <T>(pairs: readonly (readonly [...unknown[], number])[]): T => {
    const total = pairs.reduce((s, p) => s + (p[p.length - 1] as number), 0);
    let r = rand() * total;
    for (const p of pairs) {
      r -= p[p.length - 1] as number;
      if (r <= 0) return p as unknown as T;
    }
    return pairs[pairs.length - 1] as unknown as T;
  };
  const themes = compileThemes(config.themes);
  const nowIso = new Date().toISOString();

  // Campaign days in Tehran (first day busiest after the SMS blast, a bump on day 4 after the reminder).
  const days: string[] = [];
  for (let t = config.opensAt.getTime(); t <= config.closesAt.getTime(); t += 86_400_000) days.push(tehranDayKey(new Date(t)));
  const dayWeights = days.map((_, i) => [i, [35, 20, 12, 15, 8, 5, 5][i] ?? 4] as const);
  const instant = (): string => {
    const [dayIndex] = weighted<readonly [number, number]>(dayWeights);
    const day = days[dayIndex] ?? days[0]!;
    const hour = weighted<readonly [number, number]>([[9, 6], [10, 10], [11, 12], [12, 10], [13, 6], [14, 5], [15, 5], [16, 6], [17, 9], [18, 10], [19, 9], [20, 7], [21, 5]])[0];
    const minute = Math.floor(rand() * 60);
    const date = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:30`);
    // Never in the future relative to the campaign close, never before opening.
    const t = Math.min(Math.max(date.getTime(), config.opensAt.getTime()), config.closesAt.getTime());
    return new Date(t).toISOString();
  };

  return db.transaction(() => {
    clearDemo(db);
    const insertCustomer = db.prepare(`INSERT INTO customers (mobile, name, company, city, province, customer_type, value_tier,
      sales_rep, first_purchase_date, imported_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    const customers: { id: number; mobile: string; name: string; city: string; type: string; tier: string; rep: string }[] = [];
    for (let i = 1; i <= DEMO_CUSTOMERS; i++) {
      const [city, province] = weighted<readonly [string, string, number]>(CITIES);
      const [type] = weighted<readonly [string, number]>(TYPES);
      const [tier] = weighted<readonly [string, number]>(TIERS);
      const [rep] = weighted<readonly [string, number]>(REPS);
      const last = pick(LAST);
      const name = `${pick(FIRST)} ${last}`;
      const company =
        type === 'عطاری' ? `عطاری ${last}` : type === 'پخش‌کننده' ? `پخش ${pick(SHOP_WORDS)}` : `${type} ${pick(SHOP_WORDS)}`;
      const mobile = `09990${String(i).padStart(6, '0')}`;
      const firstPurchase = `${1398 + Math.floor(rand() * 7)}/${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}/${String(1 + Math.floor(rand() * 29)).padStart(2, '0')}`;
      const id = Number(insertCustomer.run(mobile, name, company, city, province, type, tier, rep, firstPurchase, nowIso).lastInsertRowid);
      customers.push({ id, mobile, name, city, type, tier, rep });
    }

    const insertResponse = db.prepare(`INSERT INTO responses (mobile, customer_id, score, category, drivers, comment, contact_ok,
      src, rep, duration_ms, ip_hash, user_agent, created_at, followup_status, followup_note, followup_by, followup_at,
      theme_tags, featured, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')`);
    const insertEvent = db.prepare('INSERT OR IGNORE INTO events (session_id, type, src, created_at) VALUES (?, ?, ?, ?)');

    const pool = [...customers];
    let events = 0;
    for (let i = 0; i < DEMO_RESPONSES; i++) {
      const matched = i < DEMO_RESPONSES - 15;
      const customer = matched ? pool.splice(Math.floor(rand() * pool.length), 1)[0]! : null;
      // Satisfaction shifts by segment so the "why?" section has something to show.
      let bias = 0;
      if (customer) {
        bias += customer.tier === 'A' ? 0.6 : customer.tier === 'C' ? -0.3 : 0;
        bias += customer.rep === 'r03' ? -0.9 : customer.rep === 'r05' ? 0.5 : 0;
        bias += customer.city === 'اهواز' ? -0.9 : customer.city === 'تهران' ? 0.2 : 0;
        bias += customer.type === 'رستوران' ? -0.3 : 0;
      }
      const pPromoter = Math.min(0.85, Math.max(0.1, 0.47 + 0.12 * bias));
      const pDetractor = Math.min(0.7, Math.max(0.04, 0.2 - 0.09 * bias));
      const r = rand();
      const category: Category = r < pPromoter ? 'promoter' : r < pPromoter + pDetractor ? 'detractor' : 'passive';
      const score =
        category === 'promoter' ? (rand() < 0.6 ? 10 : 9)
        : category === 'passive' ? (rand() < 0.55 ? 8 : 7)
        : weighted<readonly [number, number]>([[0, 3], [1, 2], [2, 5], [3, 10], [4, 15], [5, 30], [6, 35]])[0];
      if (categorize(score) !== category) throw new Error('demo category mismatch');

      const drivers = config.survey.drivers
        .map((d) => d.id)
        .filter((id) => {
          let p = DRIVER_P[category][id] ?? 0.1;
          if (id === 'delivery' && customer?.city === 'اهواز' && category !== 'promoter') p += 0.35;
          if (id === 'sales_team' && customer?.rep === 'r03' && category !== 'promoter') p += 0.3;
          return rand() < p;
        });
      const wantsComment = rand() < (category === 'detractor' ? 0.78 : category === 'promoter' ? 0.5 : 0.6);
      const comment = wantsComment ? pick(COMMENTS[category]) : null;
      const contactOk = category === 'detractor' ? rand() < 0.6 : category === 'passive' ? rand() < 0.3 : false;
      const [src] = weighted<readonly [string, number]>(CHANNELS);
      const createdAt = instant();
      const mobile = customer?.mobile ?? `09991${String(i).padStart(6, '0')}`;

      let status = category === 'detractor' ? 'todo' : 'none';
      let note: string | null = null;
      let by: string | null = null;
      let at: string | null = null;
      if (category === 'detractor') {
        status = weighted<readonly [string, number]>([['todo', 45], ['called', 25], ['resolved', 18], ['unreachable', 12]])[0];
        if (status !== 'todo') {
          note = pick(NOTES[status] ?? ['']);
          by = pick(STAFF);
          at = new Date(Math.min(Date.parse(createdAt) + (6 + rand() * 40) * 3600_000, config.closesAt.getTime())).toISOString();
        }
      }
      const duration = Math.round(Math.exp(Math.log(42_000) + (rand() - 0.5) * 1.1));
      insertResponse.run(
        mobile, customer?.id ?? null, score, category, JSON.stringify(drivers), comment, contactOk ? 1 : 0, src,
        customer && rand() < 0.7 ? customer.rep : null, duration, Math.floor(rand() * 2 ** 48).toString(16).padStart(12, '0'),
        pick(UAS), createdAt, status, note, by, at, JSON.stringify(tagThemes(comment, themes)), 0,
      );
      const sid = `demo-r${i}`;
      for (const type of ['view', 'score_selected', 'step2_done', 'submitted']) events += insertEvent.run(sid, type, src, createdAt).changes;
    }

    // Visitors who left early, so the funnel shows real drop-off.
    const dropouts: [string[], number][] = [[['view'], 120], [['view', 'score_selected'], 40], [['view', 'score_selected', 'step2_done'], 12]];
    let n = 0;
    for (const [types, count] of dropouts) {
      for (let k = 0; k < count; k++) {
        const [src] = weighted<readonly [string, number]>(CHANNELS);
        const at = instant();
        for (const type of types) events += insertEvent.run(`demo-d${n}`, type, src, at).changes;
        n++;
      }
    }

    // A few hand-picked quotes for the printed report.
    db.prepare(`UPDATE responses SET featured = 1 WHERE id IN (
      SELECT id FROM responses WHERE kind = 'demo' AND length(comment) > 40 ORDER BY id LIMIT 4)`).run();
    return { customers: customers.length, responses: DEMO_RESPONSES, events };
  })();
}
