import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileThemes, normalizeFa, tagThemes, type ThemeDef } from '../../src/core/themes.ts';

const defs: ThemeDef[] = [
  { id: 'delivery', label: 'ارسال', keywords: ['دیر', 'تاخیر', 'نرسید', 'دیر رسید'], exclude: ['دیروز'] },
  { id: 'price', label: 'قیمت', keywords: ['گران', 'قیمت', 'نرخ'] },
  { id: 'quality', label: 'کیفیت', keywords: ['تازه', 'کیفیت', 'عطر', 'رنگ'], exact: ['بو'] },
  { id: 'packaging', label: 'بسته‌بندی', keywords: ['بسته‌بندی'] },
];
const themes = compileThemes(defs);

describe('normalizeFa', () => {
  it('unifies Arabic yeh/kaf, alef variants, hamza and tatweel', () => {
    expect(normalizeFa('كيفيت')).toBe('کیفیت');
    expect(normalizeFa('تأخیر')).toBe('تاخیر');
    expect(normalizeFa('قيـــمت')).toBe('قیمت');
    expect(normalizeFa('مسئول')).toBe('مسیول');
  });

  it('turns ZWNJ and punctuation into single spaces and digits into ASCII', () => {
    expect(normalizeFa('بسته‌بندی‌ها!! عالی، ۱۰')).toBe('بسته بندی ها عالی 10');
  });

  it('removes diacritics', () => {
    expect(normalizeFa('قِیمَت')).toBe('قیمت');
  });
});

describe('tagThemes', () => {
  it('matches keyword prefixes', () => {
    expect(tagThemes('قیمت‌ها خیلی گرانه', themes)).toEqual(['price']);
  });

  it('handles Arabic ی/ک in the text', () => {
    expect(tagThemes('كيفيت جنس پايين بود', themes)).toEqual(['quality']);
  });

  it('handles ZWNJ vs space vs joined spelling', () => {
    expect(tagThemes('بسته‌بندی ضعیف', themes)).toEqual(['packaging']);
    expect(tagThemes('بسته بندی ضعیف', themes)).toEqual(['packaging']);
  });

  it('does not match inside words («دیر» ≠ «مدیر»)', () => {
    expect(tagThemes('مدیر فروش خیلی محترم بود', themes)).toEqual([]);
  });

  it('respects exclude words («دیروز»)', () => {
    expect(tagThemes('دیروز سفارش دادم', themes)).toEqual([]);
    expect(tagThemes('دیروز سفارش دادم ولی دیر رسید', themes)).toEqual(['delivery']);
  });

  it('exact words do not match as prefixes («بو» ≠ «بود»)', () => {
    expect(tagThemes('همه چیز خوب بود', themes)).toEqual([]);
    expect(tagThemes('بو نداشت', themes)).toEqual(['quality']);
  });

  it('returns several themes in config order', () => {
    expect(tagThemes('ادویه تازه نبود و ارسال با تأخیر انجام شد، قیمت هم بالا', themes)).toEqual([
      'delivery', 'price', 'quality',
    ]);
  });

  it('empty and null text → no tags', () => {
    expect(tagThemes('', themes)).toEqual([]);
    expect(tagThemes(null, themes)).toEqual([]);
    expect(tagThemes('   ، ؛ ', themes)).toEqual([]);
  });

  it('the shipped config/themes.json compiles and tags typical comments', () => {
    const shipped = compileThemes(JSON.parse(readFileSync('config/themes.json', 'utf8')).themes);
    expect(tagThemes('سفارشم سه روز دیر رسید', shipped)).toContain('delivery');
    expect(tagThemes('نرخ‌ها نسبت به بازار گرونه', shipped)).toContain('price');
    expect(tagThemes('زعفران عطر و رنگ خوبی داشت', shipped)).toContain('quality');
    expect(tagThemes('پسته‌ها عالی بود', shipped)).not.toContain('delivery');
  });
});
