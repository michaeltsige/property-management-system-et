/**
 * Shared calendar types.
 *
 * A `CivilDate` is a *date-only* value in a specific calendar system. It carries
 * no time zone. Instants in the database are always UTC/Gregorian `Date`s; civil
 * dates exist only at the input/output boundary.
 */

export type CalendarKind = 'ethiopian' | 'gregorian';

export const CALENDAR_KINDS: readonly CalendarKind[] = ['ethiopian', 'gregorian'];

export interface CivilDate {
  year: number;
  /** 1-12 for both calendars, plus 13 (Pagume) for the Ethiopian calendar. */
  month: number;
  day: number;
  calendar: CalendarKind;
}

/**
 * A monthly billing period in a given calendar.
 *
 * `key` is stable, human readable and sortable: `"<year>-<MM>"`, e.g.
 * `"2019-01"` for Meskerem 2019 E.C. or `"2026-10"` for October 2026 G.C.
 * Because the calendar travels with the key, the same string can never be
 * ambiguous (it is a different calendar's key, and both live in separate rows
 * keyed by lease).
 */
export interface BillingPeriod {
  calendar: CalendarKind;
  year: number;
  month: number;
  key: string;
}

/** UI languages. `en` is the source of truth for translation keys. */
export type LanguageCode = 'en' | 'am' | 'om' | 'ti';

export const LANGUAGE_CODES: readonly LanguageCode[] = ['en', 'am', 'om', 'ti'];
