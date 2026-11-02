// Keyword-based Persian theme tagging (no LLM, no external API).
import { toAsciiDigits } from './fa.ts';

export interface ThemeDef {
  id: string;
  label: string;
  /** Matched at the start of a word: «قیمت» also hits «قیمت‌ها»; «دیر» never hits «مدیر». */
  keywords: string[];
  /** Whole-word only: «بو» must not hit «بود». */
  exact?: string[];
  /** Words (prefix match) that must not count, e.g. «دیروز» for the «دیر» keyword. */
  exclude?: string[];
}

export interface CompiledTheme {
  id: string;
  label: string;
  prefix: string[][];
  exact: string[][];
  exclude: string[][];
}

const CHAR_MAP: Record<string, string> = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی',
  'ك': 'ک',
  'ة': 'ه', 'ۀ': 'ه',
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
  'ؤ': 'و',
};

/** Unifies Arabic/Persian letter variants, drops diacritics/tatweel, turns ZWNJ and punctuation into spaces. */
export function normalizeFa(text: string): string {
  return toAsciiDigits(text)
    .replace(/[يىئكةۀأإآٱؤ]/g, (c) => CHAR_MAP[c] ?? c)
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u0621]/g, '')
    .replace(/[\u200B\u200D-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u200C/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeFa(text);
  return normalized ? normalized.split(' ') : [];
}

export function compileThemes(defs: readonly ThemeDef[]): CompiledTheme[] {
  const compile = (words: readonly string[] | undefined) =>
    (words ?? []).map(tokenize).filter((tokens) => tokens.length > 0);
  return defs.map((def) => ({
    id: def.id,
    label: def.label,
    prefix: compile(def.keywords),
    exact: compile(def.exact),
    exclude: compile(def.exclude),
  }));
}

/** Every word must match exactly, except the last one which may be a prefix when `prefixLast`. */
function matchesAt(tokens: readonly string[], i: number, phrase: readonly string[], prefixLast: boolean): boolean {
  if (i + phrase.length > tokens.length) return false;
  for (let j = 0; j < phrase.length; j++) {
    const token = tokens[i + j] ?? '';
    const word = phrase[j] ?? '';
    const isLast = j === phrase.length - 1;
    if (isLast && prefixLast ? !token.startsWith(word) : token !== word) return false;
  }
  return true;
}

export function tagThemes(text: string | null | undefined, themes: readonly CompiledTheme[]): string[] {
  if (!text) return [];
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const tags: string[] = [];
  for (const theme of themes) {
    let hit = false;
    for (let i = 0; i < tokens.length && !hit; i++) {
      if (theme.exclude.some((phrase) => matchesAt(tokens, i, phrase, true))) continue;
      hit =
        theme.prefix.some((phrase) => matchesAt(tokens, i, phrase, true)) ||
        theme.exact.some((phrase) => matchesAt(tokens, i, phrase, false));
    }
    if (hit) tags.push(theme.id);
  }
  return tags;
}
