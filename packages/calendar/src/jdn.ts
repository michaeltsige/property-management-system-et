/**
 * Julian Day Number primitives.
 *
 * Every conversion in this package goes through the JDN, a continuous day count.
 * That keeps the Ethiopian and Gregorian implementations independent of each
 * other and makes "add N days" trivial and DST-proof.
 *
 * Gregorian formulas below are the standard Fliegel–Van Flandern integer
 * formulas; `jdn.test.ts` round-trips every day from 1800 to 2200 and pins
 * known anchors (e.g. 2000-01-01 == JDN 2451545).
 */

export interface GregorianDate {
  year: number;
  month: number;
  day: number;
}

/** Gregorian (proleptic) calendar date -> Julian Day Number. */
export function gregorianToJdn(year: number, month: number, day: number): number {
  assertInteger(year, 'year');
  assertInteger(month, 'month');
  assertInteger(day, 'day');
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** Julian Day Number -> Gregorian (proleptic) calendar date. */
export function jdnToGregorian(jdn: number): GregorianDate {
  assertInteger(jdn, 'jdn');
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

/** Day of week: 0 = Sunday … 6 = Saturday. (JDN 0 fell on a Monday.) */
export function jdnToDayOfWeek(jdn: number): number {
  return (jdn + 1) % 7;
}

export function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function gregorianDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) throw new RangeError(`Gregorian month out of range: ${month}`);
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  const base = lengths[month - 1] as number;
  return month === 2 && isGregorianLeapYear(year) ? 29 : base;
}

export function isRealGregorianDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= gregorianDaysInMonth(year, month);
}

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) throw new TypeError(`${name} must be an integer, received: ${value}`);
}
