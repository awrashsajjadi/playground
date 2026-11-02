// Regenerates the web logo (PNG + WebP, trimmed) and the link-preview image (og.png)
// from the original artwork in docs/brand/. Run after replacing the logo: npm run brand
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = `data:image/png;base64,${readFileSync(`${root}docs/brand/logo-green.png`).toString('base64')}`;
const font = readFileSync(`${root}public/fonts/Vazirmatn-NL-Bold.woff2`).toString('base64');
const LOGO_HEIGHT = 150; // shown at 50 CSS px → sharp on 3× screens

const browser = await chromium.launch();
const page = await browser.newPage();

const logo = await page.evaluate(
  async ({ src, height }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const probe = document.createElement('canvas');
    probe.width = img.width;
    probe.height = img.height;
    const pctx = probe.getContext('2d')!;
    pctx.drawImage(img, 0, 0);
    const data = pctx.getImageData(0, 0, img.width, img.height).data;
    let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0;
    for (let i = 3; i < data.length; i += 4) {
      if ((data[i] ?? 0) < 8) continue;
      const p = (i - 3) / 4;
      const x = p % img.width;
      const y = Math.floor(p / img.width);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const w = x1 - x0 + 3;
    const h = y1 - y0 + 3;
    const out = document.createElement('canvas');
    out.height = height;
    out.width = Math.round((w * height) / h);
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x0 - 1, y0 - 1, w, h, 0, 0, out.width, out.height);
    return { png: out.toDataURL('image/png'), webp: out.toDataURL('image/webp', 0.9), width: out.width };
  },
  { src: source, height: LOGO_HEIGHT },
);
writeFileSync(`${root}public/img/logo.png`, Buffer.from(logo.png.split(',')[1] ?? '', 'base64'));
writeFileSync(`${root}public/img/logo.webp`, Buffer.from(logo.webp.split(',')[1] ?? '', 'base64'));
console.log(`logo: ${logo.width}×${LOGO_HEIGHT}`);

// 1200×630 Open Graph image (WhatsApp/Telegram/Bale do not render SVG previews).
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><html dir="rtl"><head><style>
  @font-face { font-family: V; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 700; }
  html, body { margin: 0; width: 1200px; height: 630px; background: #fffbf5; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px;
         font-family: V, sans-serif; border-bottom: 14px solid #004a14; box-sizing: border-box; }
  img { height: 330px; }
  p { margin: 0; font-size: 46px; font-weight: 700; color: #004a14; }
</style></head><body><img src="${source}" alt=""><p>نظرسنجی رضایت مشتریان</p></body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${root}public/img/og.png` });
console.log('og.png: 1200×630');
await browser.close();
