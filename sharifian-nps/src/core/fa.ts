// Persian number/digit helpers. Shared by server and browser bundles.

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits → ASCII digits. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** ASCII digits → Persian digits, for display only. */
export function faDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

const formats = new Map<number, Intl.NumberFormat>();

/** Locale number with Persian digits and separators, e.g. 1234.5 → ۱٬۲۳۴٫۵ */
export function faNumber(n: number, fractionDigits = 0): string {
  let nf = formats.get(fractionDigits);
  if (!nf) {
    nf = new Intl.NumberFormat('fa-IR', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formats.set(fractionDigits, nf);
  }
  return nf.format(Math.abs(n) < 1e-9 ? 0 : n);
}

/** 0.423 → ۴۲٪ */
export function faPercent(ratio: number, fractionDigits = 0): string {
  return `${faNumber(ratio * 100, fractionDigits)}٪`;
}

/** Signed number with a real minus sign: +۴۲ / −۱۲ / ۰. Wrap in an LTR isolate inside RTL text. */
export function faSigned(n: number, fractionDigits = 0): string {
  const rounded = Number(n.toFixed(fractionDigits));
  const abs = faNumber(Math.abs(rounded), fractionDigits);
  if (rounded > 0) return `+${abs}`;
  if (rounded < 0) return `−${abs}`;
  return abs;
}
