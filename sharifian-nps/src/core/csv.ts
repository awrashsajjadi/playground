// Small CSV reader/writer: quotes, BOM, , ; tab ، delimiters, Excel-friendly output.

export type CsvEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1256';

/**
 * UTF-8 (with/without BOM) → UTF-16 (BOM) → windows-1256.
 * Excel on Persian Windows saves "CSV (Comma delimited)" as windows-1256.
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1256').decode(bytes), encoding: 'windows-1256' };
  }
}

const DELIMITERS = [',', ';', '\t', '؛'] as const;

/** Picks the delimiter that occurs most often (outside quotes) in the first non-empty line. */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>();
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (counts.size > 0) break;
    } else if (!inQuotes && (DELIMITERS as readonly string[]).includes(ch)) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }
  let best = ',';
  let bestCount = 0;
  for (const [delimiter, count] of counts) {
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

export interface CsvRow {
  /** 1-based line where the row starts (for error messages). */
  line: number;
  cells: string[];
}

/** Lenient RFC 4180 parser. Blank rows are skipped; a quote only opens at the start of a field. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const endRow = () => {
    cells.push(field);
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    field = '';
  };

  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== '' || cells.length > 0) endRow();
  return rows;
}

export type CsvValue = string | number | null | undefined;

/** Neutralises spreadsheet formulas in free text (=, +, -, @ at the start). Numbers are left alone. */
function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 with BOM + comma + CRLF so Persian opens correctly in Excel. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvValue>>, options: { bom?: boolean } = {}): string {
  const body = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  return `${options.bom === false ? '' : '\uFEFF'}${body}\r\n`;
}
