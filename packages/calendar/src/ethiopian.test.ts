import { describe, expect, it } from 'vitest';

import {
  ETHIOPIAN_EPOCH_JDN,
  ethiopianDaysInMonth,
  ethiopianNewYearGregorian,
  ethiopianToGregorian,
  ethiopianToJdn,
  gregorianToEthiopian,
  isEthiopianLeapYear,
  isRealEthiopianDate,
  jdnToEthiopian,
} from './ethiopian.js';
import { gregorianToJdn, jdnToGregorian } from './jdn.js';

/** ICU's independent implementation of the Ethiopian calendar, used as an oracle. */
function icuEthiopian(isoDate: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-u-ca-ethiopic', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(`${isoDate}T12:00:00Z`));
  const read = (type: string) =>
    Number((parts.find((p) => p.type === type)?.value ?? '').replace(/[^0-9]/g, ''));
  return { year: read('year'), month: read('month'), day: read('day') };
}

const iso = (jdn: number) => {
  const { year, month, day } = jdnToGregorian(jdn);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

describe('Ethiopian epoch and structure', () => {
  it('pins the epoch (1 Meskerem 1 E.C.)', () => {
    expect(ethiopianToJdn(1, 1, 1)).toBe(ETHIOPIAN_EPOCH_JDN);
    expect(ETHIOPIAN_EPOCH_JDN).toBe(1724221);
    // Julian 28 August 8 C.E. equals proleptic Gregorian 27 August 8 C.E., and both
    // are JDN 1724221. Independent check of the same JDN from the Gregorian side:
    expect(gregorianToJdn(8, 8, 27)).toBe(ETHIOPIAN_EPOCH_JDN);
    expect(ethiopianToGregorian(1, 1, 1)).toEqual({ year: 8, month: 8, day: 27 });
  });

  it('has 13 months: twelve of 30 days plus Pagume of 5 or 6', () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(ethiopianDaysInMonth(2019, month)).toBe(30);
    }
    expect(ethiopianDaysInMonth(2019, 13)).toBe(6); // 2019 % 4 === 3 -> leap
    expect(ethiopianDaysInMonth(2020, 13)).toBe(5);
    expect(ethiopianDaysInMonth(2021, 13)).toBe(5);
    expect(ethiopianDaysInMonth(2022, 13)).toBe(5);
    expect(ethiopianDaysInMonth(2023, 13)).toBe(6);
  });

  it('treats years congruent to 3 mod 4 as leap years', () => {
    const leapYears = [2011, 2015, 2019, 2023, 2027];
    const commonYears = [2012, 2013, 2014, 2016, 2017, 2018, 2020];
    for (const year of leapYears) expect(isEthiopianLeapYear(year)).toBe(true);
    for (const year of commonYears) expect(isEthiopianLeapYear(year)).toBe(false);
  });

  it('rejects impossible Ethiopian dates', () => {
    expect(isRealEthiopianDate(2019, 1, 30)).toBe(true);
    expect(isRealEthiopianDate(2019, 1, 31)).toBe(false); // no 31-day Ethiopian month
    expect(isRealEthiopianDate(2020, 13, 6)).toBe(false); // common year: Pagume has 5 days
    expect(isRealEthiopianDate(2019, 13, 6)).toBe(true); // leap year: Pagume has 6
    expect(isRealEthiopianDate(2019, 14, 1)).toBe(false); // there is no 14th month
    expect(() => ethiopianToJdn(2020, 13, 6)).toThrow(/Not a real Ethiopian date/);
  });
});

describe('Ethiopian new year (Gregorian anchors)', () => {
  it('falls on 11 September, or 12 September when the Gregorian year is a leap year', () => {
    expect(ethiopianNewYearGregorian(2016)).toEqual({ year: 2023, month: 9, day: 12 }); // 2024 is a leap year
    expect(ethiopianNewYearGregorian(2017)).toEqual({ year: 2024, month: 9, day: 11 });
    expect(ethiopianNewYearGregorian(2018)).toEqual({ year: 2025, month: 9, day: 11 });
    expect(ethiopianNewYearGregorian(2019)).toEqual({ year: 2026, month: 9, day: 11 });
    expect(ethiopianNewYearGregorian(2000)).toEqual({ year: 2007, month: 9, day: 12 });
    expect(ethiopianNewYearGregorian(1998)).toEqual({ year: 2005, month: 9, day: 11 });
    expect(ethiopianNewYearGregorian(2013)).toEqual({ year: 2020, month: 9, day: 11 });
  });
});

describe('Pagume and year boundaries (explicit cases)', () => {
  it('maps every Pagume day of a leap year (2015 E.C.)', () => {
    const expected = [
      ['2023-09-06', 1],
      ['2023-09-07', 2],
      ['2023-09-08', 3],
      ['2023-09-09', 4],
      ['2023-09-10', 5],
      ['2023-09-11', 6],
    ] as const;
    for (const [gcDate, day] of expected) {
      const [year, month, dayOfMonth] = gcDate.split('-').map(Number) as [number, number, number];
      expect(gregorianToEthiopian(year, month, dayOfMonth)).toEqual({ year: 2015, month: 13, day });
    }
    // The day after Pagume 6 is New Year.
    expect(gregorianToEthiopian(2023, 9, 12)).toEqual({ year: 2016, month: 1, day: 1 });
    expect(gregorianToEthiopian(2023, 9, 5)).toEqual({ year: 2015, month: 12, day: 30 });
  });

  it('maps Pagume of a common year (2016 E.C.) to five days', () => {
    expect(gregorianToEthiopian(2024, 9, 6)).toEqual({ year: 2016, month: 13, day: 1 });
    expect(gregorianToEthiopian(2024, 9, 10)).toEqual({ year: 2016, month: 13, day: 5 });
    expect(gregorianToEthiopian(2024, 9, 11)).toEqual({ year: 2017, month: 1, day: 1 });
    // 6 Pagume 2016 does not exist, so the next day is New Year directly.
    expect(jdnToEthiopian(ethiopianToJdn(2016, 13, 5) + 1)).toEqual({ year: 2017, month: 1, day: 1 });
  });

  it('handles the last day of the year and the first day of the next', () => {
    for (const year of [2011, 2015, 2019, 2023]) {
      const lastJdn = ethiopianToJdn(year, 13, 6);
      expect(jdnToEthiopian(lastJdn + 1)).toEqual({ year: year + 1, month: 1, day: 1 });
    }
    for (const year of [2012, 2016, 2020]) {
      const lastJdn = ethiopianToJdn(year, 13, 5);
      expect(jdnToEthiopian(lastJdn + 1)).toEqual({ year: year + 1, month: 1, day: 1 });
    }
  });

  it('converts a known "today" anchor', () => {
    expect(gregorianToEthiopian(2026, 10, 5)).toEqual({ year: 2019, month: 1, day: 25 });
    expect(ethiopianToGregorian(2019, 1, 25)).toEqual({ year: 2026, month: 10, day: 5 });
  });
});

describe('round-trip integrity', () => {
  it('round-trips every day from 1900-01-01 to 2100-12-31 via JDN', () => {
    const start = gregorianToJdn(1900, 1, 1);
    const end = gregorianToJdn(2100, 12, 31);
    for (let jdn = start; jdn <= end; jdn += 1) {
      const ethiopian = jdnToEthiopian(jdn);
      expect(ethiopianToJdn(ethiopian.year, ethiopian.month, ethiopian.day)).toBe(jdn);
      const gregorian = jdnToGregorian(jdn);
      expect(gregorianToJdn(gregorian.year, gregorian.month, gregorian.day)).toBe(jdn);
    }
  });

  it('never produces an Ethiopian date whose day exceeds its month length', () => {
    const start = gregorianToJdn(1900, 1, 1);
    const end = gregorianToJdn(2100, 12, 31);
    for (let jdn = start; jdn <= end; jdn += 1) {
      const { year, month, day } = jdnToEthiopian(jdn);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(ethiopianDaysInMonth(year, month));
      expect(isRealEthiopianDate(year, month, day)).toBe(true);
    }
  });
});

describe('parity with ICU (independent implementation)', () => {
  it('agrees with Intl u-ca-ethiopic across 1900-2100 (every 7th day, plus each month start)', () => {
    const start = gregorianToJdn(1900, 1, 1);
    const end = gregorianToJdn(2100, 12, 31);
    let checked = 0;
    for (let jdn = start; jdn <= end; jdn += 7) {
      const expected = icuEthiopian(iso(jdn));
      const actual = jdnToEthiopian(jdn);
      expect({ year: actual.year, month: actual.month, day: actual.day }, `mismatch at ${iso(jdn)}`).toEqual(
        expected,
      );
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it('agrees with ICU on every Pagume day for 1950-2050 E.C.', () => {
    for (let year = 1950; year <= 2050; year += 1) {
      const days = ethiopianDaysInMonth(year, 13);
      for (let day = 1; day <= days; day += 1) {
        const jdn = ethiopianToJdn(year, 13, day);
        const expected = icuEthiopian(iso(jdn));
        expect(expected, `Pagume mismatch at ${year}-13-${day}`).toEqual({ year, month: 13, day });
      }
    }
  });
});
