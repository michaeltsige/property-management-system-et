/**
 * Calendar-agnostic operations on civil (date-only) values.
 *
 * Everything here is implemented through the JDN, so the same functions work for
 * both calendars — including the Ethiopian 13th month of 5/6 days, which breaks
 * naive "add one month" code.
 */

import {
  ethiopianDaysInMonth,
  ethiopianMonthName,
  ethiopianToJdn,
  isRealEthiopianDate,
  jdnToEthiopian,
} from './ethiopian.js';
import {
  gregorianToJdn,
  isRealGregorianDate,
  jdnToGregorian,
  jdnToDayOfWeek,
  gregorianDaysInMonth,
} from './jdn.js';
import type { CalendarKind, CivilDate, LanguageCode } from './types.js';

export interface JdnRange {
  /** Inclusive first day. */
  startJdn: number;
  /** Exclusive last day (i.e. the day after the range). */
  endJdnExclusive: number;
}

export function civilToJdn(civil: CivilDate): number {
  return civil.calendar === 'ethiopian'
    ? ethiopianToJdn(civil.year, civil.month, civil.day)
    : gregorianToJdn(civil.year, civil.month, civil.day);
}

export function jdnToCivil(jdn: number, calendar: CalendarKind): CivilDate {
  if (calendar === 'ethiopian') {
    const { year, month, day } = jdnToEthiopian(jdn);
    return { year, month, day, calendar };
  }
  const { year, month, day } = jdnToGregorian(jdn);
  return { year, month, day, calendar };
}

export function convertCivil(civil: CivilDate, target: CalendarKind): CivilDate {
  if (civil.calendar === target) return { ...civil };
  return jdnToCivil(civilToJdn(civil), target);
}

export function isValidCivilDate(civil: CivilDate): boolean {
  return civil.calendar === 'ethiopian'
    ? isRealEthiopianDate(civil.year, civil.month, civil.day)
    : isRealGregorianDate(civil.year, civil.month, civil.day);
}

export function assertValidCivilDate(civil: CivilDate): void {
  if (!isValidCivilDate(civil)) {
    throw new RangeError(
      `Not a real date in the ${civil.calendar} calendar: ${civil.year}-${civil.month}-${civil.day}`,
    );
  }
}

export function daysInMonth(civil: Pick<CivilDate, 'year' | 'month' | 'calendar'>): number {
  return civil.calendar === 'ethiopian'
    ? ethiopianDaysInMonth(civil.year, civil.month)
    : gregorianDaysInMonth(civil.year, civil.month);
}

/** Months per calendar year: the Ethiopian year has a 13th month (Pagume). */
export const MONTHS_PER_YEAR: Record<CalendarKind, number> = {
  ethiopian: 13,
  gregorian: 12,
};

export function addDays(civil: CivilDate, days: number): CivilDate {
  assertValidCivilDate(civil);
  if (!Number.isInteger(days)) throw new TypeError(`days must be an integer, received: ${days}`);
  return jdnToCivil(civilToJdn(civil) + days, civil.calendar);
}

export function differenceInDays(from: CivilDate, to: CivilDate): number {
  return civilToJdn(to) - civilToJdn(from);
}

export function startOfMonth(civil: CivilDate): CivilDate {
  return { ...civil, day: 1 };
}

export function endOfMonth(civil: CivilDate): CivilDate {
  return { ...civil, day: daysInMonth(civil) };
}

export function startOfYear(civil: CivilDate): CivilDate {
  return { ...civil, month: 1, day: 1 };
}

/**
 * Add whole months, clamping the day to the target month's length.
 *
 * Clamping matters a lot here: Ethiopian month 13 (Pagume) has only 5 or 6 days,
 * so `addMonths(NehasePatume)`, or any 30-day month arithmetic that lands on
 * Pagume, must not produce an invalid date such as `13-30`. The number of months
 * in a year comes from the calendar (13 for Ethiopian, 12 for Gregorian) — using
 * a single constant here was a real bug caught by the test suite.
 */
export function addMonths(civil: CivilDate, months: number): CivilDate {
  assertValidCivilDate(civil);
  if (!Number.isInteger(months)) throw new TypeError(`months must be an integer, received: ${months}`);
  const monthsInYear = MONTHS_PER_YEAR[civil.calendar];
  const monthIndex = civil.month - 1 + months;
  const yearShift = Math.floor(monthIndex / monthsInYear);
  const normalizedMonth = monthIndex - yearShift * monthsInYear + 1;
  const target = { ...civil, year: civil.year + yearShift, month: normalizedMonth, day: 1 };
  return { ...target, day: Math.min(civil.day, daysInMonth(target)) };
}

/** Clamp a desired day-of-month (e.g. a rent due day) to a real day in that month. */
export function clampDayOfMonth(
  civil: Pick<CivilDate, 'year' | 'month' | 'calendar'>,
  desiredDay: number,
): CivilDate {
  if (!Number.isInteger(desiredDay) || desiredDay < 1) {
    throw new RangeError(`Day of month must be a positive integer, received: ${desiredDay}`);
  }
  const max = daysInMonth(civil);
  // Build a clean CivilDate: callers may pass a BillingPeriod, which carries a
  // `key` that must not leak into the returned date.
  return { year: civil.year, month: civil.month, day: Math.min(desiredDay, max), calendar: civil.calendar };
}

export function compareCivil(a: CivilDate, b: CivilDate): number {
  return civilToJdn(a) - civilToJdn(b);
}

export function isSameCivilDate(a: CivilDate, b: CivilDate): boolean {
  return civilToJdn(a) === civilToJdn(b);
}

export function isBefore(a: CivilDate, b: CivilDate): boolean {
  return civilToJdn(a) < civilToJdn(b);
}

export function isAfter(a: CivilDate, b: CivilDate): boolean {
  return civilToJdn(a) > civilToJdn(b);
}

/** 0 = Sunday … 6 = Saturday (Ethiopian weeks conventionally start on Sunday too). */
export function dayOfWeek(civil: CivilDate): number {
  return jdnToDayOfWeek(civilToJdn(civil));
}

/**
 * Convert a civil date into a `Date` at UTC midnight.
 *
 * The database stores UTC instants, so a date-only value maps to UTC midnight of
 * the *Gregorian* equivalent. Note `Date.UTC` misinterprets years 0–99 as 1900s,
 * so we set the full year explicitly.
 */
export function civilToUtcDate(civil: CivilDate): Date {
  const gregorian = convertCivil(civil, 'gregorian');
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(gregorian.year, gregorian.month - 1, gregorian.day);
  return date;
}

/** Read a UTC timestamp (e.g. from Postgres) as a civil date in the given calendar. */
export function utcDateToCivil(date: Date, calendar: CalendarKind): CivilDate {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return calendar === 'ethiopian'
    ? convertCivil({ year, month, day, calendar: 'gregorian' }, 'ethiopian')
    : { year, month, day, calendar: 'gregorian' };
}

/** Today, read from a clock, in the requested calendar (defaults to the real clock). */
export function todayIn(calendar: CalendarKind, now: Date = new Date()): CivilDate {
  return utcDateToCivil(now, calendar);
}

/** ISO `YYYY-MM-DD` of the Gregorian equivalent — the interchange format. */
export function toIsoDate(civil: CivilDate): string {
  const g = convertCivil(civil, 'gregorian');
  return `${String(g.year).padStart(4, '0')}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`;
}

export function fromIsoDate(iso: string, calendar: CalendarKind = 'gregorian'): CivilDate {
  const match = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) throw new RangeError(`Expected an ISO date (YYYY-MM-DD), received: ${iso}`);
  const [, y, m, d] = match;
  const gregorian: CivilDate = { year: Number(y), month: Number(m), day: Number(d), calendar: 'gregorian' };
  if (!isValidCivilDate(gregorian)) throw new RangeError(`Not a real Gregorian date: ${iso}`);
  return calendar === 'gregorian' ? gregorian : convertCivil(gregorian, calendar);
}

export function monthName(
  civil: Pick<CivilDate, 'month' | 'calendar'>,
  language: LanguageCode = 'en',
): string {
  if (civil.calendar === 'ethiopian') return ethiopianMonthName(civil.month, language);
  const names: Record<LanguageCode, readonly string[]> = GREGORIAN_MONTH_NAMES;
  const name = (names[language] ?? names.en)[civil.month - 1];
  if (!name) throw new RangeError(`Gregorian month out of range (1-12): ${civil.month}`);
  return name;
}

/** Gregorian month names, used for display when the user prefers the Gregorian calendar. */
export const GREGORIAN_MONTH_NAMES: Record<LanguageCode, readonly string[]> = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  am: ['ጃንዩወሪ', 'ፌብሩወሪ', 'ማርች', 'ኤፕሪል', 'ሜይ', 'ጁን', 'ጁላይ', 'ኦገስት', 'ሴፕቴምበር', 'ኦክቶበር', 'ኖቬምበር', 'ዲሴምበር'],
  om: [
    'Amajjii',
    'Guraandhala',
    'Bitooteessa',
    'Elba',
    'Caamsa',
    'Waxabajjii',
    'Adooleessa',
    'Hagayya',
    'Fuulbana',
    'Onkololeessa',
    'Sadaasa',
    'Muddee',
  ],
  ti: ['ጥሪ', 'ለካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰነ', 'ሓምለ', 'ነሓሰ', 'መስከረም', 'ጥቅምቲ', 'ሕዳር', 'ታሕሳስ'],
};

export const WEEKDAY_NAMES: Record<LanguageCode, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  am: ['እሑድ', 'ሰኞ', 'ማክሰኞ', 'ረቡዕ', 'ሐሙስ', 'ዓርብ', 'ቅዳሜ'],
  om: ['Dilbata', 'Wiixata', 'Qibxata', 'Roobii', 'Kamiisa', 'Jimaata', 'Sanbata'],
  ti: ['ሰንበት', 'ሰኑይ', 'ሰሉስ', 'ረቡዕ', 'ሓሙስ', 'ዓርቢ', 'ቀዳም'],
};
