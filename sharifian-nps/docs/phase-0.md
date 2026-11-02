# فاز ۰: نقشه‌ی پروژه

> **وضعیت: منتظر تأیید.** هنوز کد برنامه نوشته نشده است. این سند نقشه‌ی فازهای ۱ تا ۵ است.
> هر تصمیمی که در `PROMPT.md` نبود، با شماره‌ی D در [`DECISIONS.md`](../DECISIONS.md) ثبت شده است.
> نسخه‌ها و اندازه‌هایی که در این سند آمده، امروز (۱۱ آبان ۱۴۰۵) روی npm و در همین محیط بررسی و اندازه‌گیری شده‌اند.

## ۱. معماری در یک نگاه

- **یک پروسه‌ی Node (Fastify).** فرم، API و پنل ادمین همه از همین پروسه سرو می‌شوند. داده‌ها در یک فایل SQLite روی `/data` هستند.
- **فقط ۳ وابستگی runtime:** `fastify`، `better-sqlite3` و `eta`. کارهای جانبی (کوکی، سشن، CSRF، CSV، rate limit، فایل ثابت و gzip) را خودمان می‌نویسیم، هرکدام در کمتر از ۴۰ خط (D4).
- **سرور build ندارد.** Node 22 فایل‌های `.ts` را مستقیم اجرا می‌کند (D3). فقط کد مرورگر با esbuild باندل می‌شود (D5). به همین خاطر `normalizeMobile` واقعاً یک فایل است که هم سرور و هم مرورگر از آن استفاده می‌کنند.
- **منطق خالص در `src/core/` است و هیچ I/O ندارد.** موبایل، NPS، برچسب‌گذاری متن، CSV، تاریخ و همه‌ی محاسبات داشبورد این‌جا هستند، پس تست unit ساده می‌ماند.
- **تست HTTP با `fastify.inject`** روی یک SQLite در حافظه انجام می‌شود.
- **ساعت از بیرون به اپ داده می‌شود (`now()`).** تست باز یا بسته بودن نظرسنجی و قانون «کمتر از ۳ ثانیه» بدون sleep انجام می‌شود.

## ۲. ساختار پوشه‌ها

```text
sharifian-nps/
├── PROMPT.md                 مستر پرامپت (مرجع)
├── DECISIONS.md
├── README.fa.md                                   ← فاز ۵
├── package.json · tsconfig.json · vitest.config.ts · playwright.config.ts
├── .env.example · .gitignore · .dockerignore
├── Dockerfile · liara.json · docker-compose.yml · Caddyfile   ← فاز ۵
├── config/
│   ├── survey.fa.json        همه‌ی متن‌ها، چیپ‌ها، کانال‌ها، نام کارشناس‌ها
│   └── themes.json           کلیدواژه‌های تحلیل متن
├── public/                   همه‌چیز self-hosted
│   ├── fonts/                Vazirmatn-NL-Regular.woff2 · Vazirmatn-NL-Bold.woff2 · OFL.txt
│   ├── img/                  logo.svg · favicon.svg
│   ├── css/                  form.css · admin.css · report.css
│   └── build/                خروجی esbuild (در gitignore)
├── src/
│   ├── server.ts             شروع: env ← db ← listen
│   ├── app.ts                buildApp({ config, db, now }) — در تست inject می‌شود
│   ├── config.ts             خواندن و اعتبارسنجی env و JSONهای config
│   ├── db/
│   │   ├── schema.sql
│   │   ├── db.ts             open (WAL, foreign_keys) + migrate با PRAGMA user_version
│   │   └── queries.ts        همه‌ی SQLها به‌صورت prepared statement
│   ├── core/                 منطق خالص بدون I/O  ← تست unit
│   │   ├── mobile.ts         normalizeMobile (مشترک سرور و مرورگر)
│   │   ├── nps.ts            categorize · computeNps · حاشیه‌ی خطا
│   │   ├── themes.ts         normalizeFa · tagThemes
│   │   ├── csv.ts            decode · parse · stringify با BOM
│   │   ├── date.ts           تاریخ شمسی و وقت تهران با Intl
│   │   ├── fa.ts             ارقام فارسی، فرمت عدد و درصد
│   │   ├── analytics.ts      همه‌ی محاسبات داشبورد روی ردیف‌ها
│   │   ├── crypto.ts         امضا و تأیید HMAC · مقایسه‌ی امن · ip_hash
│   │   └── rate-limit.ts
│   ├── plugins/              افزونه‌های Fastify
│   │   ├── assets.ts         فایل ثابت از حافظه + hash + gzip
│   │   ├── auth.ts           سشن ادمین + CSRF
│   │   ├── views.ts          eta + هلپرهای قالب
│   │   └── security.ts       هدرهای امنیتی، لاگ بدون IP
│   ├── services/
│   │   ├── submit.ts         اعتبارسنجی + ضد اسپم + ذخیره + مچ مشتری
│   │   ├── customers.ts      import و upsert · مچ مجدد
│   │   ├── notify.ts         وبهوک بله/تلگرام
│   │   └── backup.ts
│   ├── routes/
│   │   ├── survey.ts         /  · /api/submit · /api/events · /thanks · /already
│   │   ├── admin.ts          ورود · خانه · import · لینک‌ها · اکشن‌ها · بکاپ
│   │   ├── exports.ts        سه خروجی CSV
│   │   └── dashboard.ts      /admin/dashboard · /admin/report
│   ├── client/               TypeScript مرورگر  ← esbuild ← public/build/
│   │   ├── form.ts
│   │   ├── admin.ts
│   │   └── dashboard.ts      به‌اضافه‌ی Chart.js
│   └── views/                قالب‌های eta
│       ├── layout.eta · form.eta · message.eta   (تشکر/تکراری/بسته/هنوز باز نشده/خطا)
│       └── admin/            login · home · import · links · dashboard · report
├── scripts/
│   ├── build-client.ts       esbuild
│   ├── seed-demo.ts · seed-clear.ts
│   ├── load-test.ts          autocannon
│   ├── screenshots.ts        Playwright ← docs/screenshots
│   └── backup.sh
├── tests/
│   ├── unit/                 mobile · nps · themes · csv · date · analytics · rate-limit
│   ├── integration/          survey-api · admin · import-export   (fastify.inject)
│   └── e2e/                  form · admin · a11y · perf           (Playwright)
├── docs/
│   ├── phase-0.md            همین فایل
│   └── screenshots/
└── data/                     دیتابیس محلی (در gitignore)
```

## ۳. اسکیمای دیتابیس (SQLite)

ستون‌هایی که با `[+]` مشخص شده‌اند به اسکیمای سند اضافه شده‌اند (D26). همه‌ی زمان‌ها رشته‌ی ISO به وقت UTC هستند.

```sql
PRAGMA journal_mode = WAL;     -- خواندن هم‌زمان با نوشتن
PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  id                  INTEGER PRIMARY KEY,
  mobile              TEXT NOT NULL UNIQUE,              -- 09xxxxxxxxx (نرمال‌شده)
  name                TEXT,
  company             TEXT,
  city                TEXT,
  province            TEXT,
  customer_type       TEXT,                              -- عطاری، سوپرمارکت، رستوران، پخش‌کننده…
  value_tier          TEXT CHECK (value_tier IN ('A','B','C')),
  sales_rep           TEXT,                              -- ترجیحاً کد کوتاه (D57)
  first_purchase_date TEXT,                              -- همان‌طور که در CSV آمده
  imported_at         TEXT NOT NULL,
  is_demo             INTEGER NOT NULL DEFAULT 0         -- [+] ساخته‌ی seed:demo
);

CREATE TABLE responses (
  id              INTEGER PRIMARY KEY,
  mobile          TEXT NOT NULL,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  score           INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  category        TEXT NOT NULL CHECK (category IN ('promoter','passive','detractor')),
  drivers         TEXT NOT NULL DEFAULT '[]',            -- JSON از شناسه‌ی چیپ‌ها: ["quality","price"]
  comment         TEXT,
  contact_ok      INTEGER NOT NULL DEFAULT 0,
  src             TEXT NOT NULL DEFAULT 'direct',
  rep             TEXT,
  duration_ms     INTEGER,
  ip_hash         TEXT,
  user_agent      TEXT,
  created_at      TEXT NOT NULL,
  followup_status TEXT NOT NULL DEFAULT 'none'
                  CHECK (followup_status IN ('none','todo','called','resolved','unreachable')),
  followup_note   TEXT,
  followup_by     TEXT,
  followup_at     TEXT,
  theme_tags      TEXT NOT NULL DEFAULT '[]',            -- JSON: ["delivery","price"]
  featured        INTEGER NOT NULL DEFAULT 0,            -- [+] نقل‌قول منتخب گزارش (D48)
  kind            TEXT NOT NULL DEFAULT 'live'           -- [+] live | test | demo (D27، D28)
                  CHECK (kind IN ('live','test','demo'))
);
-- «هر موبایل فقط یک پاسخ» برای پاسخ‌های واقعی؛ ثبت آزمایشی و دمو از این قید آزادند
CREATE UNIQUE INDEX ux_responses_mobile_live ON responses(mobile) WHERE kind = 'live';
CREATE INDEX ix_responses_created  ON responses(created_at);
CREATE INDEX ix_responses_customer ON responses(customer_id);

CREATE TABLE duplicate_attempts (
  id         INTEGER PRIMARY KEY,
  mobile     TEXT NOT NULL,
  score      INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_duplicate_mobile ON duplicate_attempts(mobile);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,                              -- تصادفی، بدون داده‌ی شخصی
  type       TEXT NOT NULL CHECK (type IN ('view','score_selected','step2_done','submitted')),
  src        TEXT NOT NULL DEFAULT 'direct',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_events_session_type ON events(session_id, type);  -- هر مرحله برای هر سشن یک بار
CREATE INDEX ix_events_type_created ON events(type, created_at);
```

چند نکته:

- **مچ مشتری.** `customer_id` هنگام ثبت پاسخ از روی موبایل پر می‌شود. بعد از هر import هم این دستور اجرا می‌شود:
  `UPDATE responses SET customer_id = (SELECT id FROM customers c WHERE c.mobile = responses.mobile)`
- **پیگیری Detractor.** پاسخ Detractor هنگام ثبت `followup_status = 'todo'` می‌گیرد. بقیه‌ی پاسخ‌ها `'none'` می‌مانند.
- **migration.** نسخه‌ی اسکیما در `PRAGMA user_version` نگه داشته می‌شود تا تغییرهای بعدی کنترل‌شده اعمال شوند.

## ۴. مسیرها

### عمومی

| روش | مسیر | کار |
|---|---|---|
| GET | `/` | فرم سه‌گامی، یا صفحه‌ی «هنوز باز نشده» یا «بسته شده». پارامترها: `src`، `rep` و `t` (لینک آزمایشی) |
| POST | `/api/submit` | ثبت پاسخ. اگر JSON بیاید (از JS): کد ۲۰۱، ۴۰۰، ۴۰۳، ۴۰۹ یا ۴۲۹. اگر urlencoded بیاید (بدون JS): ریدایرکت ۳۰۳ |
| POST | `/api/events` | رویداد Funnel که با sendBeacon می‌آید؛ پاسخ ۲۰۴ |
| GET | `/thanks` | صفحه‌ی تشکر با دکمه‌ی «رفتن به فروشگاه شریفیان» |
| GET | `/already` | «شما قبلاً نظرتان را ثبت کرده‌اید. ممنونیم!» |
| GET | `/assets/*` | فایل‌های ثابت هش‌دار (CSS، JS، فونت، لوگو) با کش immutable |
| GET | `/healthz` | بررسی سلامت (پینگ دیتابیس) برای Docker و لیارا |
| GET | `/robots.txt` | `Disallow: /` |

### ادمین

همه‌ی مسیرها به‌جز ورود سشن می‌خواهند. اگر سشن نباشد، صفحه‌ی HTML به ورود ریدایرکت می‌شود (۳۰۲) و درخواست POST یا دانلود CSV جواب ۴۰۱ می‌گیرد. همه‌ی POSTها توکن CSRF می‌خواهند.

| روش | مسیر | کار |
|---|---|---|
| GET | `/admin/login` | فرم ورود (رمز و نام اختیاری) |
| POST | `/admin/login` | بررسی رمز و ساختن کوکی سشن |
| POST | `/admin/logout` | خروج |
| GET | `/admin` | خانه: وضعیت کمپین، اعداد سریع، هشدار داده‌ی دمو یا آزمایشی، ابزارها |
| GET | `/admin/import` | صفحه‌ی ورود فایل CSV مشتریان |
| POST | `/admin/import/preview` | فایل را می‌گیرد و ۱۰ ردیف اول، گزارش خطاها و شمارش‌ها را برمی‌گرداند (JSON) |
| POST | `/admin/import/commit` | فایل را می‌گیرد، upsert و مچ مجدد را اجرا می‌کند و خلاصه را برمی‌گرداند (JSON) |
| POST | `/admin/rematch` | مچ مجدد دستی پاسخ‌ها با مشتریان |
| GET | `/admin/links` | لینک آماده برای هر کانال و هر کارشناس، به‌اضافه‌ی لینک‌های آزمایشی |
| GET | `/admin/export/responses.csv` | همه‌ی پاسخ‌ها |
| GET | `/admin/export/non-respondents.csv` | مشتریانی که هنوز پاسخ نداده‌اند، با لینک شخصی |
| GET | `/admin/export/followups.csv` | لیست پیگیری Detractorها |
| GET | `/admin/dashboard` | داشبورد. فیلترها: `from`، `to`، `src`، `city`، `type`، `tier`، `rep`، `matched` |
| GET | `/admin/report` | گزارش اجرایی برای چاپ یا PDF، با همان فیلترها |
| POST | `/admin/responses/:id/followup` | تغییر وضعیت و یادداشت پیگیری |
| POST | `/admin/responses/:id/featured` | ستاره زدن نقل‌قول منتخب |
| POST | `/admin/responses/delete` | حذف پاسخ با شماره موبایل (با تأیید) |
| POST | `/admin/test-data/delete` | حذف همه‌ی ثبت‌های آزمایشی |
| GET | `/admin/backup` | دانلود یک اسنپ‌شات سالم از دیتابیس |

## ۵. جریان ثبت پاسخ (`POST /api/submit`)

سرور این بررسی‌ها را به همین ترتیب انجام می‌دهد:

1. **بازه‌ی زمانی.** اگر نظرسنجی هنوز باز نشده یا بسته شده (و حالت آزمایشی هم نیست): کد ۴۰۳ با `not_open` یا `closed`.
2. **سقف درخواست.** بیش از ۱۰ ثبت در ساعت از یک `ip_hash`: کد ۴۲۹.
3. **honeypot.** اگر فیلد مخفی پر شده باشد: کد ۴۰۰ با `rejected`. چیزی ذخیره نمی‌شود.
4. **توکن فرم.** امضا باید معتبر باشد و دست‌کم ۳ ثانیه از رندر فرم (به ساعت سرور) گذشته باشد؛ وگرنه کد ۴۰۰ با `too_fast`.
5. **اعتبار ورودی‌ها.** امتیاز ۰ تا ۱۰، فقط چیپ‌های مجاز، متن حداکثر ۱۰۰۰ نویسه، و موبایل نرمال‌شده‌ی معتبر. خطا: کد ۴۰۰ همراه خطای هر فیلد.
6. **شماره‌ی تکراری.** اگر پاسخ live با همین موبایل وجود داشته باشد، تلاش در `duplicate_attempts` ثبت می‌شود و جواب ۴۰۹ می‌رود (یا ۳۰۳ به `/already` برای فرم بدون JS).
7. **ذخیره.** در یک تراکنش: مچ مشتری، محاسبه‌ی `category` و `theme_tags`، `todo` برای Detractor، INSERT پاسخ و ثبت رویداد `submitted`.
8. **هشدار فوری.** اگر امتیاز ۶ یا کمتر است و وبهوک تنظیم شده، پیام در پس‌زمینه فرستاده می‌شود.
9. **پاسخ.** کد ۲۰۱ (یا ۳۰۳ به `/thanks` برای فرم بدون JS).

## ۶. مسیر داده‌ی داشبورد

1. فیلترها از query string خوانده می‌شوند.
2. یک SELECT پاسخ‌ها را با مشتری‌ها LEFT JOIN می‌کند و فیلترها را اعمال می‌کند.
3. `core/analytics.ts` از روی ردیف‌ها همه‌ی بخش‌ها را حساب می‌کند: kpis، stacked، histogram، daily، channels، funnel، drivers، segments، themes، comments و followups.
4. KPIها و جدول‌ها با eta به HTML تبدیل می‌شوند و داده‌ی نمودارها به‌شکل JSON داخل صفحه قرار می‌گیرد.
5. `dashboard.js` نمودارها را با Chart.js رسم می‌کند.

## ۷. بودجه‌ی حجم صفحه‌ی فرم (سقف ۱۲۰KB)

| بخش | حجم |
|---|---|
| فونت Vazirmatn-NL، وزن ۴۰۰ و ۷۰۰ (اندازه‌گیری‌شده) | ۴۴KB |
| HTML با gzip | حدود ۴KB |
| CSS با gzip | حدود ۳KB |
| JS با gzip (خامش کمتر از ۱۵KB) | حدود ۴KB |
| لوگوی SVG | حدود ۲KB |
| **جمع تخمینی** | **حدود ۵۷KB** |

برای مقایسه: نسخه‌ی کامل Vazirmatn به‌تنهایی ۱۰۲KB است (D7). E2E هم حجم واقعی و هم «صفر درخواست به دامنه‌ی خارجی» را چک می‌کند.

## ۸. متغیرهای محیطی

همه‌ی متغیرهای سند (`PORT`، `DATABASE_PATH`، `ADMIN_PASSWORD`، `SESSION_SECRET`، `SURVEY_OPENS_AT`، `SURVEY_CLOSES_AT`، `PUBLIC_BASE_URL`، `DETRACTOR_WEBHOOK_URL`) سر جایشان هستند. چند متغیر اختیاری با مقدار پیش‌فرض هم اضافه می‌شود:

```env
RATE_LIMIT_PER_HOUR=10        # D22
TRUST_PROXY=true              # D11
CONFIG_DIR=./config           # D51
BACKUP_DIR=                   # پیش‌فرض: پوشه‌ی backups کنار دیتابیس (D33)
```

اپ هنگام شروع متغیرها را اعتبارسنجی می‌کند. در production اگر `SESSION_SECRET` کوتاه‌تر از ۳۲ نویسه باشد یا `ADMIN_PASSWORD` تنظیم نشده باشد، اپ اصلاً بالا نمی‌آید و خطای روشن می‌دهد.

## ۹. وابستگی‌ها

- **runtime (فقط سه تا):** `fastify` 5.12 · `better-sqlite3` 13.0 · `eta` 4.6
- **dev:** `typescript` 7.0 · `@types/node` 22 · `@types/better-sqlite3` · `esbuild` 0.28 · `vitest` 5.0 · `@playwright/test` 1.63.0 (هم‌نسخه‌ی مرورگر نصب‌شده) · `@axe-core/playwright` 4.14 · `autocannon` 8 · `chart.js` 4.6 (فقط داخل باندل داشبورد) · `vazirmatn` 33 (فقط منبعی برای کپی فایل فونت)

## ۱۰. اسکریپت‌های npm

| دستور | کار |
|---|---|
| `npm run dev` | `node --watch src/server.ts` |
| `npm start` | `node src/server.ts` |
| `npm run build` | فقط باندل مرورگر (esbuild) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: تست‌های unit و integration |
| `npm run test:e2e` | Playwright: E2E و دسترس‌پذیری |
| `npm run test:load` | autocannon (اول خودش یک سرور موقت بالا می‌آورد) |
| `npm run seed:demo` / `npm run seed:clear` | ساختن و پاک کردن داده‌ی نمایشی |
| `npm run screenshots` | گرفتن اسکرین‌شات و ذخیره در `docs/screenshots/` |
| `npm run backup` | `scripts/backup.sh` |

## ۱۱. تست‌های هر فاز

| فاز | تست و خروجی |
|---|---|
| ۱ | unit: `normalizeMobile` (بیش از ۱۵ کیس)، `categorize`، `computeNps` و حاشیه‌ی خطا، برچسب‌گذاری متن، تاریخ شمسی، rate limit. integration: ثبت، تکراری، بازه‌ی زمانی، honeypot، ثبت سریع، rate limit، امتیاز نامعتبر. اسکرین‌شات موبایل |
| ۲ | unit: پارس CSV. integration: ورود ادمین، CSRF، import و مچ مجدد، خروجی با BOM و لیست پاسخ‌نداده‌ها |
| ۳ | unit: `analytics` روی داده‌ی معلوم. seed دمو. اسکرین‌شات داشبورد و گزارش چاپی |
| ۴ | E2E روی سه viewport، axe، وزن صفحه و درخواست خارجی، تست بار، هشدار بله |
| ۵ | ساخت و اجرای ایمیج Docker، `README.fa.md` |

## ۱۲. سؤال‌های باز

1. **Node 22 به‌جای 20 (D1).** موافقید؟ اگر Node 20 لازم باشد، باید نسخه‌های قدیمی‌تر وابستگی‌ها را بگیریم و برای سرور هم مرحله‌ی build بگذاریم.
2. **محل پروژه (D2).** همین پوشه‌ی `sharifian-nps/` در مخزن playground بماند، یا مخزن جدا می‌سازید که به این جلسه اضافه‌اش کنم؟
3. **لوگو و رنگ برند.** فایل SVG یا PNG لوگو و کد رنگ برند را دارید؟ اگر نه، فعلاً واژه‌نگار موقت و رنگ `#C2410C` (D25).
4. **پیش‌نویس فرم (D56).** `sessionStorage` طبق سند بماند، یا `localStorage` تا بعد از بستن تب هم بماند؟
5. **لیست پیگیری (D52).** Detractorهایی که تیک «اجازه‌ی تماس» را نزده‌اند هم در لیست تماس باشند؟ پیش‌فرض: بله، با نشان مشخص.
6. **کد کارشناس‌ها (D57).** ستون `sales_rep` در لیست مشتریان شما کد لاتین است یا نام فارسی؟
7. **اضافه‌های اسکیما و حالت آزمایشی (D26 تا D28).** تأیید می‌کنید؟
