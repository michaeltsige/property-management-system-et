/**
 * Display and input formatting.
 *
 * The rule for this package: the database is UTC/Gregorian, the *user* sees the
 * calendar and language they chose, and everything in between goes through
 * these functions.
 *
 * Intent: next-intl-agnostic. The web app will later wrap these helpers with
 * translation keys, but the date math and the 13-month grid stay here where they
 * can be unit tested.
 */

import {
  civilToJdn,
  civilToUtcDate,
  convertCivil,
  dayOfWeek,
  daysInMonth,
  monthName,
  startOfMonth,
  jdnToCivil,
  toIsoDate,
  WEEKDAY_NAMES,
} from './civil.js';
import { ETHIOPIAN_MONTH_NAMES } from './ethiopian.js';
import { periodContains, periodStart } from './periods.js';
import type { BillingPeriod, CalendarKind, CivilDate, LanguageCode } from './types.js';

export type DateStyle = 'short' | 'medium' | 'long' | 'iso';

export interface FormatOptions {
  language?: LanguageCode;
  style?: DateStyle;
  /** Append the calendar marker, e.g. `"25 Meskerem 2019 E.C."` / `"5 October 2026 G.C."`. */
  showEra?: boolean;
  /** Use Geʽez numerals for the day/year (common in Ethiopian print). Default false. */
  geezNumerals?: boolean;
}

const ERA_SUFFIX: Record<CalendarKind, string> = { ethiopian: 'E.C.', gregorian: 'G.C.' };

export function formatCivilDate(civil: CivilDate, options: FormatOptions = {}): string {
  const { language = 'en', style = 'medium', showEra = false, geezNumerals = false } = options;
  if (style === 'iso') return toIsoDate(civil);

  const dayText = geezNumerals ? toGeezNumeral(civil.day) : String(civil.day);
  const yearText = geezNumerals ? toGeezNumeral(civil.year) : String(civil.year);
  const monthText = monthName(civil, language);

  const base =
    style === 'short'
      ? `${dayText}/${civil.month}/${civil.year}`
      : style === 'long'
        ? `${monthText} ${dayText}, ${yearText}`
        : `${dayText} ${monthText} ${yearText}`;

  return showEra ? `${base} ${ERA_SUFFIX[civil.calendar]}` : base;
}

/** `"Meskerem 2019"` — month/year only, for period headers. */
export function formatMonthYear(
  input: Pick<CivilDate, 'year' | 'month' | 'calendar'>,
  language: LanguageCode = 'en',
): string {
  return `${monthName(input, language)} ${input.year}`;
}

export function formatWeekday(civil: CivilDate, language: LanguageCode = 'en'): string {
  const names = WEEKDAY_NAMES[language] ?? WEEKDAY_NAMES.en;
  return names[dayOfWeek(civil)] ?? '';
}

/** A date-time instant (UTC, as stored) shown in the user's calendar and time zone. */
export function formatTimestamp(
  instant: Date,
  options: FormatOptions & { timeZone?: string; calendar?: CalendarKind; withTime?: boolean } = {},
): string {
  const { timeZone = 'Africa/Addis_Ababa', withTime = true, calendar } = options;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? ({ hour: '2-digit', minute: '2-digit', hour12: false } as const) : {}),
  }).formatToParts(instant);

  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // The wall-clock date in the user's time zone (Addis Ababa, UTC+03:00, no DST).
  const gregorian: CivilDate = {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    calendar: 'gregorian',
  };
  const civil = calendar && calendar !== 'gregorian' ? convertCivil(gregorian, calendar) : gregorian;
  const dateText = formatCivilDate(civil, options);
  if (!withTime) return dateText;
  const hour = String(read('hour')).padStart(2, '0');
  const minute = String(read('minute')).padStart(2, '0');
  return `${dateText} ${hour}:${minute}`;
}

/**
 * Convert civil date to the equivalent `Intl`-formattable date, so callers can use
 * ICU (`u-ca-ethiopic`) for locale-aware long forms and relative formatting.
 */
export function civilToIntlDate(civil: CivilDate): Date {
  return civilToUtcDate(civil);
}

/** ICU rendering, e.g. `{ calendar: 'ethiopian', locale: 'am' }` -> "መስከረም 25 ቀን 2019 ዓ.ም." */
export function formatWithIntl(
  civil: CivilDate,
  opts: { locale?: string; calendar?: CalendarKind; dateStyle?: 'short' | 'medium' | 'long' | 'full' } = {},
): string {
  const { locale = 'en', calendar = civil.calendar, dateStyle = 'long' } = opts;
  const localeTag = calendar === 'ethiopian' ? `${locale}-u-ca-ethiopic` : locale;
  return new Intl.DateTimeFormat(localeTag, { dateStyle, timeZone: 'UTC' }).format(civilToIntlDate(civil));
}

export interface MonthGrid {
  period: BillingPeriod;
  /** Six weeks of seven days; days outside the period still belong to real dates. */
  weeks: CivilDate[][];
  /** Index of the weekday column that starts the week (0 = Sunday). */
  weekStartsOn: number;
}

/**
 * The 6×7 grid a date picker renders.
 *
 * Handles the Ethiopian 13-month year: Pagume gets its own grid with 5 or 6 days,
 * and no month of the Ethiopian calendar ever has 31 days.
 */
export function monthGrid(period: BillingPeriod, weekStartsOn = 0): MonthGrid {
  const first = periodStart(period);
  const firstJdn = civilToJdn(first);
  const offset = (dayOfWeek(first) - weekStartsOn + 7) % 7;
  const startJdn = firstJdn - offset;
  const weeks: CivilDate[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: CivilDate[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      row.push(jdnToCivil(startJdn + week * 7 + weekday, period.calendar));
    }
    weeks.push(row);
  }
  return { period, weeks, weekStartsOn };
}

/** Weekday header labels ordered to match `monthGrid`. */
export function weekdayHeaders(language: LanguageCode = 'en', weekStartsOn = 0): string[] {
  const names = WEEKDAY_NAMES[language] ?? WEEKDAY_NAMES.en;
  return Array.from({ length: 7 }, (_, index) => names[(index + weekStartsOn) % 7] ?? '');
}

/** True when the date belongs to the grid's own month (not a spill-over day). */
export function isInPeriod(civil: CivilDate, period: BillingPeriod): boolean {
  return periodContains(period, civil);
}

export function periodDays(period: BillingPeriod): CivilDate[] {
  const first = periodStart(period);
  return Array.from({ length: daysInMonth(first) }, (_, index) => ({ ...first, day: index + 1 }));
}

/** `"Pagume 5"` / `"February 29"` — handy in tests and logs. */
export function describeCivilDate(civil: CivilDate, language: LanguageCode = 'en'): string {
  return `${monthName(civil, language)} ${civil.day} ${civil.year}`;
}

export function isFirstDayOfMonth(civil: CivilDate): boolean {
  return civil.day === 1;
}

export function monthOptions(calendar: CalendarKind, language: LanguageCode = 'en'): string[] {
  const source = calendar === 'ethiopian' ? ETHIOPIAN_MONTH_NAMES : null;
  if (source) return [...(source[language] ?? source.en)];
  return Array.from({ length: 12 }, (_, index) => monthName({ month: index + 1, calendar }, language));
}

export function startOfMonthCivil(civil: CivilDate): CivilDate {
  return startOfMonth(civil);
}

// ---------------------------------------------------------------------------
// Geʽez numerals
// ---------------------------------------------------------------------------

const GEEZ_ONES = ['', '፩', '፪', '፫', '፬', '፭', '፮', '፯', '፰', '፱'];
const GEEZ_TENS = ['', '፲', '፳', '፴', '፵', '፶', '፷', '፸', '፹', '፺'];
const GEEZ_HUNDRED = '፻';
const GEEZ_TEN_THOUSAND = '፼';

/**
 * Render a positive integer in Geʽez numerals (፩ ፪ ፫ …).
 *
 * Geʽez numerals have no zero digit; `0` is returned as the ASCII zero for
 * safety, and negative or non-integer input is rejected rather than guessed at.
 */
export function toGeezNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Geʽez numerals cannot represent ${value}`);
  }
  if (value === 0) return '0';
  if (value < 10) return GEEZ_ONES[value] as string;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${GEEZ_TENS[tens] ?? ''}${ones ? (GEEZ_ONES[ones] as string) : ''}`;
  }
  if (value < 10000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    return `${hundreds > 1 ? toGeezNumeral(hundreds) : ''}${GEEZ_HUNDRED}${rest ? toGeezNumeral(rest) : ''}`;
  }
  if (value < 100000000) {
    const myriads = Math.floor(value / 10000);
    const rest = value % 10000;
    // 10,000 is written with the myriad sign alone (፼), not ፩፼; 100 myriads is ፻፼.
    return `${myriads > 1 ? toGeezNumeral(myriads) : ''}${GEEZ_TEN_THOUSAND}${rest ? toGeezNumeral(rest) : ''}`;
  }
  throw new RangeError(`Geʽez numerals above 99,999,999 are not supported by this formatter: ${value}`);
}
