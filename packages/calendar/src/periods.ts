/**
 * Monthly billing periods.
 *
 * A lease carries a `billing_calendar`. Rent is charged per *month of that
 * calendar*: 12 months of 30 days, plus Pagume (5/6 days) for Ethiopian leases.
 *
 * Period keys are stable strings (`"2019-01"`) and are paired with a unique
 * database constraint on `(lease_id, period_key)` so that generating charges
 * twice can never create duplicates.
 */

import {
  civilToJdn,
  clampDayOfMonth,
  convertCivil,
  daysInMonth,
  jdnToCivil,
  MONTHS_PER_YEAR,
  monthName,
} from './civil.js';
import { ethiopianToJdn, jdnToEthiopian } from './ethiopian.js';
import { jdnToGregorian } from './jdn.js';
import type { BillingPeriod, CalendarKind, CivilDate, LanguageCode } from './types.js';

/** Number of months in a calendar year (13 for the Ethiopian calendar). */
export { MONTHS_PER_YEAR };

export function periodKey(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function parsePeriodKey(key: string, calendar: CalendarKind): BillingPeriod {
  const match = /^(\d{4,6})-(\d{2})$/.exec(key.trim());
  if (!match) throw new RangeError(`Invalid billing period key: "${key}" (expected e.g. "2019-01")`);
  const [, y, m] = match;
  const year = Number(y);
  const month = Number(m);
  const maxMonth = MONTHS_PER_YEAR[calendar];
  if (month < 1 || month > maxMonth) {
    throw new RangeError(`Month ${month} is out of range for the ${calendar} calendar (1-${maxMonth})`);
  }
  return { calendar, year, month, key: periodKey(year, month) };
}

/** The billing period that contains a date (a period is the calendar month of the date). */
export function periodForDate(civil: CivilDate): BillingPeriod {
  return {
    calendar: civil.calendar,
    year: civil.year,
    month: civil.month,
    key: periodKey(civil.year, civil.month),
  };
}

export function periodForJdn(jdn: number, calendar: CalendarKind): BillingPeriod {
  return periodForDate(jdnToCivil(jdn, calendar));
}

export function periodStart(period: BillingPeriod): CivilDate {
  return { year: period.year, month: period.month, day: 1, calendar: period.calendar };
}

export function periodEnd(period: BillingPeriod): CivilDate {
  return { ...periodStart(period), day: daysInMonth(period) };
}

export function periodLengthDays(period: BillingPeriod): number {
  return daysInMonth(period);
}

/**
 * True when the date falls inside the period.
 *
 * Compared on the JDN axis rather than by matching year/month fields, so a date
 * expressed in the *other* calendar is still placed correctly (the date picker
 * shows Ethiopian grids, but the API may hand us a Gregorian date).
 */
export function periodContains(period: BillingPeriod, civil: CivilDate): boolean {
  const { startJdn, endJdnExclusive } = periodJdnRange(period);
  const jdn = civilToJdn(civil);
  return jdn >= startJdn && jdn < endJdnExclusive;
}

export function nextPeriod(period: BillingPeriod): BillingPeriod {
  return shiftPeriod(period, 1);
}

export function previousPeriod(period: BillingPeriod): BillingPeriod {
  return shiftPeriod(period, -1);
}

export function shiftPeriod(period: BillingPeriod, months: number): BillingPeriod {
  const maxMonth = MONTHS_PER_YEAR[period.calendar];
  const index = period.month - 1 + months;
  const yearShift = Math.floor(index / maxMonth);
  const month = index - yearShift * maxMonth + 1;
  const year = period.year + yearShift;
  return { calendar: period.calendar, year, month, key: periodKey(year, month) };
}

export function comparePeriods(a: BillingPeriod, b: BillingPeriod): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

/** Inclusive list of periods from `from` to `to`. */
export function periodsBetween(from: BillingPeriod, to: BillingPeriod): BillingPeriod[] {
  if (comparePeriods(from, to) > 0) return [];
  const result: BillingPeriod[] = [];
  let current = from;
  // Guard against runaway loops on bad input (200 years of months).
  const limit = 200 * MONTHS_PER_YEAR[from.calendar];
  while (comparePeriods(current, to) <= 0 && result.length <= limit) {
    result.push(current);
    current = nextPeriod(current);
  }
  return result;
}

/**
 * The due date for a period: the configured day within that period's month,
 * clamped to the real length of the month.
 *
 * Ethiopian Pagume often has 5 days, so a lease with `dueDay = 30` still needs a
 * sensible answer — it becomes the last day of Pagume, and this is deterministic.
 */
export function dueDateForPeriod(period: BillingPeriod, dueDayOfMonth: number): CivilDate {
  return clampDayOfMonth(period, dueDayOfMonth);
}

/**
 * A period expressed as an absolute JDN range, for date-range queries and for
 * converting into the other calendar for reporting.
 */
export function periodJdnRange(period: BillingPeriod): { startJdn: number; endJdnExclusive: number } {
  const startJdn = civilToJdn(periodStart(period));
  return { startJdn, endJdnExclusive: startJdn + periodLengthDays(period) };
}

/** `"Meskerem 2019"` / `"October 2026"` style label. */
export function periodLabel(period: BillingPeriod, language: LanguageCode = 'en'): string {
  return `${monthName(period, language)} ${period.year}`;
}

/** Same period expressed in the other calendar (used to show "≈ Sep 2026" hints). */
export function periodInOtherCalendar(period: BillingPeriod): BillingPeriod {
  const target: CalendarKind = period.calendar === 'ethiopian' ? 'gregorian' : 'ethiopian';
  // A period spans two months of the other calendar; we report the one that covers
  // the majority of days so the hint is the most intuitive.
  const startJdn = civilToJdn(periodStart(period));
  const length = periodLengthDays(period);
  const midJdn = startJdn + Math.floor(length / 2);
  return periodForJdn(midJdn, target);
}

/** Approximate Gregorian span of a period, e.g. `{ from: '2026-09-11', to: '2026-10-10' }`. */
export function periodGregorianSpan(period: BillingPeriod): { from: CivilDate; to: CivilDate } {
  const start = convertCivil(periodStart(period), 'gregorian');
  const end = convertCivil(periodEnd(period), 'gregorian');
  return { from: start, to: end };
}

/** Re-exported for convenience: build an Ethiopian period from a JDN. */
export function ethiopianPeriodOfJdn(jdn: number): BillingPeriod {
  const { year, month } = jdnToEthiopian(jdn);
  return { calendar: 'ethiopian', year, month, key: periodKey(year, month) };
}

/** Gregorian period from a JDN. */
export function gregorianPeriodOfJdn(jdn: number): BillingPeriod {
  const { year, month } = jdnToGregorian(jdn);
  return { calendar: 'gregorian', year, month, key: periodKey(year, month) };
}

/** JDN of 1 Meskerem of an Ethiopian year (helper for year filters). */
export function ethiopianYearStartJdn(year: number): number {
  return ethiopianToJdn(year, 1, 1);
}
