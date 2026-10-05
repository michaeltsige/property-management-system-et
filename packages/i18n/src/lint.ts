/**
 * Catalog linting — runs in CI and in tests.
 *
 * Catches the three classic translation bugs before they reach users:
 * 1. a key that exists in English but is missing from another language;
 * 2. a key that exists in another language but not in English (dead text);
 * 3. ICU argument mismatch — e.g. the Amharic text drops `{amount}`, so the SMS
 *    would tell a tenant their rent is due without saying how much.
 */

import type { LanguageCode } from '@pms/calendar';

import { CATALOGS } from './resolve.js';
import { extractIcuArguments, TRANSLATION_KEYS, type TranslationKey } from './keys.js';

export interface CatalogLintIssue {
  language: LanguageCode;
  key: TranslationKey | string;
  kind: 'missing' | 'extra' | 'empty' | 'icu_mismatch';
  detail: string;
}

export interface CatalogLintReport {
  ok: boolean;
  issues: CatalogLintIssue[];
  /** Percentage of English keys present per language (0–100, one decimal). */
  coverage: Record<LanguageCode, number>;
}

export function lintCatalogs(
  catalogs: Record<LanguageCode, Partial<Record<TranslationKey, string>>> = CATALOGS,
): CatalogLintReport {
  const issues: CatalogLintIssue[] = [];
  const coverage = {} as Record<LanguageCode, number>;

  // English is the source of truth for the run: a key that is not in English is
  // dead text, and every English key must exist in every other language.
  const sourceKeys = Object.keys(catalogs.en ?? {}) as TranslationKey[];
  const sourceKeyList = sourceKeys.length > 0 ? sourceKeys : TRANSLATION_KEYS;

  for (const [language, catalog] of Object.entries(catalogs) as [
    LanguageCode,
    Partial<Record<TranslationKey, string>>,
  ][]) {
    let present = 0;

    for (const key of sourceKeyList) {
      const value = catalog[key];
      if (typeof value !== 'string' || value.length === 0) {
        if (language === 'en') {
          issues.push({ language, key, kind: 'empty', detail: 'English source text is empty' });
        } else {
          issues.push({
            language,
            key,
            kind: 'missing',
            detail: 'Missing translation; English will be shown',
          });
        }
        continue;
      }
      present += 1;

      if (language !== 'en') {
        const expected = extractIcuArguments(catalogs.en[key] ?? '');
        const actual = extractIcuArguments(value);
        const missingArgs = expected.filter((arg) => !actual.includes(arg));
        const extraArgs = actual.filter((arg) => !expected.includes(arg));
        if (missingArgs.length > 0 || extraArgs.length > 0) {
          issues.push({
            language,
            key,
            kind: 'icu_mismatch',
            detail: [
              missingArgs.length ? `missing argument(s): ${missingArgs.join(', ')}` : '',
              extraArgs.length ? `unknown argument(s): ${extraArgs.join(', ')}` : '',
            ]
              .filter(Boolean)
              .join('; '),
          });
        }
      }
    }

    for (const key of Object.keys(catalog)) {
      if (!sourceKeyList.includes(key as TranslationKey)) {
        issues.push({
          language,
          key,
          kind: 'extra',
          detail: 'Key is not present in the English source catalog',
        });
      }
    }

    coverage[language] = Math.round((present / sourceKeyList.length) * 1000) / 10;
  }

  return { ok: issues.length === 0, issues, coverage };
}

export function formatLintReport(report: CatalogLintReport): string {
  const lines = [
    `Catalog coverage: ${Object.entries(report.coverage)
      .map(([language, percentage]) => `${language} ${percentage}%`)
      .join(', ')}`,
  ];
  if (report.ok) {
    lines.push('No issues found.');
    return lines.join('\n');
  }
  lines.push(`${report.issues.length} issue(s):`);
  for (const issue of report.issues) {
    lines.push(`  [${issue.language}] ${issue.key} — ${issue.kind}: ${issue.detail}`);
  }
  return lines.join('\n');
}
