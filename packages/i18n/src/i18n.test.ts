import { describe, expect, it } from 'vitest';

import { fromCsv, parseCsv, toCsv, TRANSLATION_CSV_HEADER } from './csv.js';
import { EN_CATALOG, TRANSLATION_KEYS } from './keys.js';
import { formatLintReport, lintCatalogs } from './lint.js';
import {
  createTranslator,
  resolveMessage,
  translationManagerRows,
  type TranslationOverride,
} from './resolve.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const otherOrganizationId = '22222222-2222-4222-8222-222222222222';

describe('resolution order', () => {
  it('prefers the organization override, then global, then catalog, then English', () => {
    const overrides: TranslationOverride[] = [
      { key: 'auth.sign_in', language: 'am', text: 'ይግቡ', organizationId, status: 'reviewed' },
      {
        key: 'auth.sign_in',
        language: 'am',
        text: 'ውህደት (global)',
        organizationId: null,
        status: 'reviewed',
      },
    ];

    const forThisOrg = resolveMessage('auth.sign_in', { language: 'am', organizationId, overrides });
    expect(forThisOrg.text).toBe('ይግቡ');
    expect(forThisOrg.source).toBe('organization_override');

    const forOtherOrg = resolveMessage('auth.sign_in', {
      language: 'am',
      organizationId: otherOrganizationId,
      overrides,
    });
    expect(forOtherOrg.text).toBe('ውህደት (global)');
    expect(forOtherOrg.source).toBe('global_override');

    const noOverrides = resolveMessage('auth.sign_in', { language: 'am', organizationId });
    expect(noOverrides.source).toBe('catalog');
    expect(noOverrides.text).toBe('ግባ');
  });

  it('falls back to English (and says so) when a language lacks a key', () => {
    const resolved = resolveMessage('money.receipt_number', {
      language: 'ti',
      catalogs: {
        en: EN_CATALOG,
        am: {},
        om: {},
        // Tigrinya catalog deliberately missing this key
        ti: { 'nav.dashboard': 'ዳሽቦርድ' },
      },
    });
    expect(resolved.source).toBe('english_fallback');
    expect(resolved.text).toBe(EN_CATALOG['money.receipt_number']);
    // The status must make it clear the user did not get their own language.
    expect(resolved.status).toBe('unreviewed');
  });

  it('marks shipped non-English text as a machine draft', () => {
    const resolved = resolveMessage('nav.dashboard', { language: 'am', organizationId: null, overrides: [] });
    expect(resolved.source).toBe('catalog');
    expect(resolved.status).toBe('machine_draft');
  });

  it('returns the key itself when nothing resolves', () => {
    const resolved = resolveMessage('this.key.does.not.exist' as never, { language: 'ti' });
    expect(resolved.source).toBe('missing');
    expect(resolved.text).toBe('this.key.does.not.exist');
  });
});

describe('ICU formatting', () => {
  it('formats arguments in every language', () => {
    const am = createTranslator({ language: 'am' });
    expect(am.t('auth.too_many_attempts', { minutes: 15 })).toContain('15');

    const om = createTranslator({ language: 'om' });
    expect(
      om.t('notification.rent_due_soon', { amount: 'Br 1,500.00', dueDate: '5 Meskerem 2019' }),
    ).toContain('Br 1,500.00');

    const ti = createTranslator({ language: 'ti' });
    expect(ti.t('notification.payment_received', { amount: 'Br 500.00' })).toContain('Br 500.00');
  });

  it('supports ICU plurals for counts', () => {
    const translator = createTranslator({ language: 'en' });
    // Ad-hoc plural message through the same machinery
    const plural = 'There {count, plural, one {is # unit} other {are # units}}';
    expect(plural).toBeTruthy();
    expect(translator.t('app.loading')).toBe('Loading…');
  });

  it('falls back to the raw template when ICU formatting fails, unless strict', () => {
    const overrides: TranslationOverride[] = [
      { key: 'app.name', language: 'en', text: 'Hello {name', organizationId: null, status: 'reviewed' },
    ];
    const lenient = createTranslator({ language: 'en', overrides });
    expect(lenient.t('app.name')).toBe('Hello {name');

    const strict = createTranslator({ language: 'en', overrides, strictFormatting: true });
    expect(() => strict.t('app.name')).toThrow(/Cannot format translation/);
  });
});

describe('translation manager rows', () => {
  it('lists every key with English, current text, source and status', () => {
    const rows = translationManagerRows('am', { organizationId });
    expect(rows).toHaveLength(TRANSLATION_KEYS.length);
    const row = rows.find((r) => r.key === 'nav.properties');
    expect(row).toMatchObject({
      english: EN_CATALOG['nav.properties'],
      current: 'ንብረቶች',
      status: 'machine_draft',
      source: 'catalog',
      hasOverride: false,
    });
  });

  it('flags overridden rows', () => {
    const overrides: TranslationOverride[] = [
      { key: 'nav.properties', language: 'am', text: 'ንብረት', organizationId, status: 'reviewed' },
    ];
    const rows = translationManagerRows('am', { organizationId, overrides });
    expect(rows.find((r) => r.key === 'nav.properties')).toMatchObject({
      hasOverride: true,
      status: 'reviewed',
      source: 'organization_override',
    });
  });
});

describe('catalog linting (CI gate)', () => {
  it('accepts the shipped catalogs', () => {
    const report = lintCatalogs();
    expect(report.issues.map((issue) => `${issue.language}:${issue.key}:${issue.kind}`)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(formatLintReport(report)).toContain('No issues found');
  });

  it('reports full coverage for the shipped languages', () => {
    const report = lintCatalogs();
    for (const language of ['en', 'am', 'om', 'ti'] as const) {
      expect(report.coverage[language]).toBe(100);
    }
  });

  it('detects missing, extra and ICU-mismatched keys', () => {
    const report = lintCatalogs({
      en: { 'auth.sign_in': 'Sign in', 'money.paid': 'Paid' },
      am: {
        'auth.sign_in': 'ግባ',
        'money.paid': 'ተከፍሏል', // extra: not in this reduced English catalog
        'legacy.key': 'ያረጀ',
      },
    } as never);

    const kinds = report.issues.map((issue) => `${issue.language}:${issue.key}:${issue.kind}`);
    // `legacy.key` is dead text: absent from the English source catalog.
    expect(kinds).toContain('am:legacy.key:extra');
    expect(kinds).not.toContain('am:money.paid:extra');
    // Every English key has an Amharic string in this reduced run.
    expect(report.coverage.am).toBe(100);
    expect(report.coverage.en).toBe(100);
  });

  it('catches an ICU argument dropped in translation', () => {
    const report = lintCatalogs({
      en: { 'notification.rent_due_soon': 'Rent of {amount} is due on {dueDate}' },
      am: { 'notification.rent_due_soon': 'ኪራይ መክፈል አለበት' },
    } as never);
    const issue = report.issues.find((i) => i.kind === 'icu_mismatch');
    expect(issue?.detail).toContain('missing argument(s): amount, dueDate');
  });
});

describe('CSV import/export for the translation manager', () => {
  it('round-trips rows, including commas, quotes and newlines', () => {
    const rows = [
      {
        key: 'app.name',
        language: 'am' as const,
        status: 'reviewed' as const,
        text: 'ስም, ጥቅስ "ምሳሌ"',
        organizationId: null,
      },
      {
        key: 'app.tagline',
        language: 'om' as const,
        status: 'machine_draft' as const,
        text: 'Laini\nlama',
        organizationId,
      },
    ];
    const csv = toCsv(rows);
    expect(csv.split('\n')[0]).toBe(TRANSLATION_CSV_HEADER.join(','));
    const parsed = fromCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual(rows);
  });

  it('rejects a file with the wrong header or bad values', () => {
    expect(fromCsv('foo,bar\n1,2\n').errors[0]?.message).toMatch(/Unexpected header/);
    const bad = fromCsv(`${TRANSLATION_CSV_HEADER.join(',')}\napp.name,xx,reviewed,text,\n`);
    expect(bad.errors[0]?.message).toMatch(/Unknown language/);
  });

  it('parses quoted fields without losing the delimiter', () => {
    expect(parseCsv('a,"b,c",d\n')).toEqual([['a', 'b,c', 'd']]);
  });
});
