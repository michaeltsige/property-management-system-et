/**
 * CSV import/export for the Translation Manager.
 *
 * The header row is fixed so that exported files can be edited in Excel or Google
 * Sheets and re-imported without guessing:
 *
 *   key,language,status,text,organization_id
 *
 * Values that contain commas, quotes or newlines are quoted and inner quotes
 * doubled, per RFC 4180.
 */

import type { LanguageCode } from '@pms/calendar';

import { TRANSLATION_KEYS, type TranslationKey } from './keys.js';
import type { TranslationStatus } from './resolve.js';

export const TRANSLATION_CSV_HEADER = ['key', 'language', 'status', 'text', 'organization_id'] as const;

export interface TranslationCsvRow {
  key: TranslationKey | string;
  language: LanguageCode;
  status: TranslationStatus;
  text: string;
  organizationId: string | null;
}

function escapeCsvValue(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: readonly TranslationCsvRow[]): string {
  const lines = [TRANSLATION_CSV_HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [
        escapeCsvValue(row.key),
        escapeCsvValue(row.language),
        escapeCsvValue(row.status),
        escapeCsvValue(row.text),
        escapeCsvValue(row.organizationId ?? ''),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Minimal RFC-4180 parser (handles quoted fields, embedded commas and newlines). */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

const LANGUAGES: readonly LanguageCode[] = ['en', 'am', 'om', 'ti'];
const STATUSES: readonly TranslationStatus[] = ['machine_draft', 'unreviewed', 'reviewed'];

export interface CsvParseResult {
  rows: TranslationCsvRow[];
  errors: { line: number; message: string }[];
}

export function fromCsv(input: string): CsvParseResult {
  const parsed = parseCsv(input);
  const rows: TranslationCsvRow[] = [];
  const errors: { line: number; message: string }[] = [];
  if (parsed.length === 0) return { rows, errors: [{ line: 0, message: 'Empty file' }] };

  const header = (parsed[0] ?? []).map((value) => value.trim().toLowerCase());
  if (header.join(',') !== TRANSLATION_CSV_HEADER.join(',')) {
    return {
      rows,
      errors: [{ line: 1, message: `Unexpected header. Expected: ${TRANSLATION_CSV_HEADER.join(',')}` }],
    };
  }

  parsed.slice(1).forEach((values, index) => {
    const line = index + 2;
    const [key, language, status, text, organizationId] = values;
    if (!key || !language || !text) {
      errors.push({ line, message: 'key, language and text are required' });
      return;
    }
    if (!LANGUAGES.includes(language as LanguageCode)) {
      errors.push({ line, message: `Unknown language "${language}" (expected ${LANGUAGES.join(', ')})` });
      return;
    }
    const normalizedStatus = (status || 'unreviewed') as TranslationStatus;
    if (!STATUSES.includes(normalizedStatus)) {
      errors.push({ line, message: `Unknown status "${status}"` });
      return;
    }
    rows.push({
      key,
      language: language as LanguageCode,
      status: normalizedStatus,
      text,
      organizationId: organizationId && organizationId.length > 0 ? organizationId : null,
    });
  });

  return { rows, errors };
}

/** Export a language's current state (English + shipped/overridden text) for review. */
export function exportLanguageCsv(language: LanguageCode, rows: readonly TranslationCsvRow[]): string {
  return toCsv(rows.filter((row) => row.language === language));
}

/** Export the English source catalog as a translation template. */
export function exportSourceTemplate(): string {
  return toCsv(
    TRANSLATION_KEYS.map((key) => ({
      key,
      language: 'en' as LanguageCode,
      status: 'reviewed' as TranslationStatus,
      text: '',
      organizationId: null,
    })),
  );
}
