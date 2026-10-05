/**
 * Translation resolution.
 *
 * Lookup order (fixed by the brief):
 *   1. database override for this organization
 *   2. database override that is global (platform) for the same language
 *   3. the shipped locale file
 *   4. English fallback
 *
 * The status of whatever was used is returned alongside the text, because the
 * UI must never present a machine draft as if it were a reviewed translation.
 */

import { IntlMessageFormat } from 'intl-messageformat';
import type { LanguageCode } from '@pms/calendar';

import { AM_CATALOG } from './catalogs/am.js';
import { OM_CATALOG } from './catalogs/om.js';
import { TI_CATALOG } from './catalogs/ti.js';
import { EN_CATALOG, type TranslationKey } from './keys.js';

export type TranslationStatus = 'machine_draft' | 'unreviewed' | 'reviewed';

export type MessageSource =
  'organization_override' | 'global_override' | 'catalog' | 'english_fallback' | 'missing';

export interface TranslationOverride {
  key: string;
  language: LanguageCode;
  text: string;
  /** `null` means the override applies platform-wide. */
  organizationId: string | null;
  status: TranslationStatus;
}

export const CATALOGS: Record<LanguageCode, Partial<Record<TranslationKey, string>>> = {
  en: EN_CATALOG,
  am: AM_CATALOG,
  om: OM_CATALOG,
  ti: TI_CATALOG,
};

/**
 * Review status of shipped catalog text. English is the source language and is
 * considered reviewed; every other shipped string is a machine draft until a
 * human approves it in the Translation Manager.
 */
export const REVIEWED_SHIPPED: Partial<Record<LanguageCode, readonly TranslationKey[]>> = {
  am: [],
  om: [],
  ti: [],
};

export function shippedStatus(language: LanguageCode, key: TranslationKey): TranslationStatus {
  if (language === 'en') return 'reviewed';
  const reviewed = REVIEWED_SHIPPED[language] ?? [];
  return reviewed.includes(key) ? 'reviewed' : 'machine_draft';
}

export interface ResolvedMessage {
  key: string;
  text: string;
  source: MessageSource;
  status: TranslationStatus;
  language: LanguageCode;
}

export function shippedMessage(language: LanguageCode, key: TranslationKey): string | undefined {
  const fromCatalog = CATALOGS[language]?.[key];
  if (typeof fromCatalog === 'string' && fromCatalog.length > 0) return fromCatalog;
  return undefined;
}

export function resolveMessage(
  key: TranslationKey,
  options: {
    language?: LanguageCode;
    organizationId?: string | null;
    overrides?: readonly TranslationOverride[];
    /** Override the shipped catalogs (used by tests and by future DB-driven catalogs). */
    catalogs?: Record<LanguageCode, Partial<Record<TranslationKey, string>>>;
  },
): ResolvedMessage {
  const { language = 'en', organizationId = null, overrides = [], catalogs = CATALOGS } = options;

  const forKey = overrides.filter((o) => o.key === key && o.language === language);

  const organizationOverride = organizationId
    ? forKey.find((o) => o.organizationId === organizationId)
    : undefined;
  if (organizationOverride) {
    return {
      key,
      text: organizationOverride.text,
      source: 'organization_override',
      status: organizationOverride.status,
      language,
    };
  }

  const globalOverride = forKey.find((o) => o.organizationId === null);
  if (globalOverride) {
    return {
      key,
      text: globalOverride.text,
      source: 'global_override',
      status: globalOverride.status,
      language,
    };
  }

  const shipped = catalogs[language]?.[key];
  if (typeof shipped === 'string' && shipped.length > 0) {
    return { key, text: shipped, source: 'catalog', status: shippedStatus(language, key), language };
  }

  const english = catalogs.en?.[key];
  if (typeof english === 'string' && english.length > 0) {
    // Fall back to English *but keep the requested language*: the status must
    // reveal that the user did not get their language.
    return { key, text: english, source: 'english_fallback', status: 'unreviewed', language };
  }

  return { key, text: key, source: 'missing', status: 'unreviewed', language };
}

export class TranslationFormatError extends Error {
  constructor(
    readonly key: string,
    readonly language: LanguageCode,
    cause: unknown,
  ) {
    super(
      `Cannot format translation "${key}" (${language}): ${(cause as Error)?.message ?? 'unknown error'}`,
    );
    this.name = 'TranslationFormatError';
  }
}

const formatterCache = new Map<string, IntlMessageFormat>();

function format(text: string, language: LanguageCode, values: Record<string, string | number>): string {
  const cacheKey = `${language}\u0000${text}`;
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new IntlMessageFormat(text, language);
    formatterCache.set(cacheKey, formatter);
  }
  return String(formatter.format(values));
}

export interface TranslatorOptions {
  language: LanguageCode;
  organizationId?: string | null;
  overrides?: readonly TranslationOverride[];
  /** Throw instead of falling back to the raw template when ICU formatting fails. */
  strictFormatting?: boolean;
  /** Called when a message could not be formatted in strict mode. */
  onFormatError?: (error: TranslationFormatError) => void;
}

export interface Translator {
  language: LanguageCode;
  /** Translate with ICU arguments and plurals: `t('notification.rent_due_soon', { amount, dueDate })`. */
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  /** Full resolution details, e.g. for the Translation Manager UI. */
  resolve: (key: TranslationKey) => ResolvedMessage;
}

export function createTranslator(options: TranslatorOptions): Translator {
  const {
    language,
    organizationId = null,
    overrides = [],
    strictFormatting = false,
    onFormatError,
  } = options;
  const resolve = (key: TranslationKey) => resolveMessage(key, { language, organizationId, overrides });

  return {
    language,
    resolve,
    t(key, values = {}) {
      const resolved = resolve(key);
      try {
        return format(resolved.text, language, values);
      } catch (error) {
        const formatError = new TranslationFormatError(key, language, error);
        if (strictFormatting) throw formatError;
        onFormatError?.(formatError);
        return resolved.text;
      }
    },
  };
}

/** Convenience for non-ICU strings (labels, enum display names). */
export function t(
  key: TranslationKey,
  options: TranslatorOptions & { values?: Record<string, string | number> } = { language: 'en' },
): string {
  const { values, ...rest } = options;
  return createTranslator(rest).t(key, values);
}

export interface TranslationManagerRow {
  key: TranslationKey;
  english: string;
  current: string;
  language: LanguageCode;
  status: TranslationStatus;
  source: MessageSource;
  hasOverride: boolean;
}

/**
 * Rows for the admin Translation Manager: English source, the text the user
 * actually sees, where it came from, and its review status.
 */
export function translationManagerRows(
  language: LanguageCode,
  options: { organizationId?: string | null; overrides?: readonly TranslationOverride[] } = {},
): TranslationManagerRow[] {
  return (Object.keys(EN_CATALOG) as TranslationKey[]).sort().map((key) => {
    const resolved = resolveMessage(key, { language, ...options });
    return {
      key,
      english: EN_CATALOG[key],
      current: resolved.text,
      language,
      status: resolved.status,
      source: resolved.source,
      hasOverride: resolved.source === 'organization_override' || resolved.source === 'global_override',
    };
  });
}
