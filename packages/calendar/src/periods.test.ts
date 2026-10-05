import { describe, expect, it } from 'vitest';

import { addDays, addMonths, convertCivil, differenceInDays, monthName } from './civil.js';
import type { CivilDate } from './types.js';
import {
  comparePeriods,
  dueDateForPeriod,
  MONTHS_PER_YEAR,
  nextPeriod,
  parsePeriodKey,
  periodForDate,
  periodGregorianSpan,
  periodInOtherCalendar,
  periodKey,
  periodLabel,
  periodLengthDays,
  periodsBetween,
  previousPeriod,
  shiftPeriod,
} from './periods.js';

const et = (year: number, month: number, day: number): CivilDate => ({
  year,
  month,
  day,
  calendar: 'ethiopian',
});
const gc = (year: number, month: number, day: number): CivilDate => ({
  year,
  month,
  day,
  calendar: 'gregorian',
});

describe('period keys and construction', () => {
  it('derives the period from a date', () => {
    expect(periodForDate(et(2019, 1, 25)).key).toBe('2019-01');
    expect(periodForDate(et(2015, 13, 6)).key).toBe('2015-13');
    expect(periodForDate(gc(2026, 10, 5)).key).toBe('2026-10');
  });

  it('formats and parses keys without losing the calendar', () => {
    expect(periodKey(2019, 1)).toBe('2019-01');
    expect(parsePeriodKey('2019-13', 'ethiopian')).toMatchObject({
      year: 2019,
      month: 13,
      calendar: 'ethiopian',
    });
    expect(() => parsePeriodKey('2019-13', 'gregorian')).toThrow(/out of range/);
    expect(() => parsePeriodKey('2019-1', 'gregorian')).toThrow(/Invalid billing period key/);
  });

  it('has 13 months in the Ethiopian year and 12 in the Gregorian year', () => {
    expect(MONTHS_PER_YEAR.ethiopian).toBe(13);
    expect(MONTHS_PER_YEAR.gregorian).toBe(12);
  });
});

describe('period arithmetic', () => {
  it('rolls from month 13 into the next year for Ethiopian leases', () => {
    expect(previousPeriod(parsePeriodKey('2019-01', 'ethiopian')).key).toBe('2018-13');
    expect(previousPeriod(parsePeriodKey('2020-01', 'ethiopian')).key).toBe('2019-13');
    expect(previousPeriod(parsePeriodKey('2019-12', 'ethiopian')).key).toBe('2019-11');
    expect(nextPeriod(parsePeriodKey('2019-12', 'ethiopian')).key).toBe('2019-13');
    expect(nextPeriod(parsePeriodKey('2019-13', 'ethiopian')).key).toBe('2020-01');
  });

  it('rolls December into January for Gregorian leases', () => {
    expect(nextPeriod(parsePeriodKey('2026-12', 'gregorian')).key).toBe('2027-01');
    expect(previousPeriod(parsePeriodKey('2026-01', 'gregorian')).key).toBe('2025-12');
  });

  it('shifts by many months at once', () => {
    // 12 months after Meskerem is the 13th month (Pagume); 13 months is the next new year.
    expect(shiftPeriod(parsePeriodKey('2019-01', 'ethiopian'), 12).key).toBe('2019-13');
    expect(shiftPeriod(parsePeriodKey('2019-01', 'ethiopian'), 13).key).toBe('2020-01');
    expect(shiftPeriod(parsePeriodKey('2026-01', 'gregorian'), -1).key).toBe('2025-12');
    expect(shiftPeriod(parsePeriodKey('2019-13', 'ethiopian'), 1).key).toBe('2020-01');
  });

  it('measures the real length of months, including Pagume and Gregorian February', () => {
    expect(periodLengthDays(parsePeriodKey('2019-01', 'ethiopian'))).toBe(30);
    expect(periodLengthDays(parsePeriodKey('2019-13', 'ethiopian'))).toBe(6); // leap
    expect(periodLengthDays(parsePeriodKey('2020-13', 'ethiopian'))).toBe(5); // common
    expect(periodLengthDays(parsePeriodKey('2024-02', 'gregorian'))).toBe(29);
    expect(periodLengthDays(parsePeriodKey('2026-02', 'gregorian'))).toBe(28);
  });

  it('enumerates periods inclusively, spanning both Ethiopian years and Pagume', () => {
    const list = periodsBetween(
      parsePeriodKey('2019-12', 'ethiopian'),
      parsePeriodKey('2020-02', 'ethiopian'),
    );
    expect(list.map((p) => p.key)).toEqual(['2019-12', '2019-13', '2020-01', '2020-02']);
    // A full Ethiopian year is 13 months.
    const year = periodsBetween(
      parsePeriodKey('2019-01', 'ethiopian'),
      parsePeriodKey('2019-13', 'ethiopian'),
    );
    expect(year).toHaveLength(13);
    expect(
      periodsBetween(parsePeriodKey('2020-01', 'ethiopian'), parsePeriodKey('2019-01', 'ethiopian')),
    ).toEqual([]);
  });

  it('compares periods', () => {
    expect(
      comparePeriods(parsePeriodKey('2019-12', 'ethiopian'), parsePeriodKey('2019-13', 'ethiopian')),
    ).toBeLessThan(0);
    expect(
      comparePeriods(parsePeriodKey('2020-01', 'ethiopian'), parsePeriodKey('2019-13', 'ethiopian')),
    ).toBeGreaterThan(0);
  });
});

describe('due dates', () => {
  it('uses the configured day of the month', () => {
    expect(dueDateForPeriod(parsePeriodKey('2019-01', 'ethiopian'), 5)).toEqual(et(2019, 1, 5));
    expect(dueDateForPeriod(parsePeriodKey('2026-10', 'gregorian'), 1)).toEqual(gc(2026, 10, 1));
  });

  it('clamps a due day that does not exist in the month', () => {
    // Pagume has only 5 or 6 days, so a "30th of the month" due day lands on the last day.
    expect(dueDateForPeriod(parsePeriodKey('2019-13', 'ethiopian'), 30)).toEqual(et(2019, 13, 6));
    expect(dueDateForPeriod(parsePeriodKey('2020-13', 'ethiopian'), 30)).toEqual(et(2020, 13, 5));
    // 31 January + 1 month clamps to the end of February.
    expect(dueDateForPeriod(parsePeriodKey('2024-02', 'gregorian'), 31)).toEqual(gc(2024, 2, 29));
    expect(dueDateForPeriod(parsePeriodKey('2025-02', 'gregorian'), 31)).toEqual(gc(2025, 2, 28));
  });
});

describe('cross-calendar helpers', () => {
  it('shows the Gregorian span of an Ethiopian period', () => {
    expect(periodGregorianSpan(parsePeriodKey('2019-01', 'ethiopian'))).toEqual({
      from: gc(2026, 9, 11),
      to: gc(2026, 10, 10),
    });
    expect(periodGregorianSpan(parsePeriodKey('2019-13', 'ethiopian'))).toEqual({
      from: gc(2027, 9, 6),
      to: gc(2027, 9, 11),
    });
  });

  it('finds the equivalent period in the other calendar', () => {
    expect(periodInOtherCalendar(parsePeriodKey('2019-01', 'ethiopian')).calendar).toBe('gregorian');
    const mid = periodInOtherCalendar(parsePeriodKey('2019-01', 'ethiopian'));
    expect(mid.year).toBe(2026);
    expect([9, 10]).toContain(mid.month);
  });

  it('labels periods in the selected language', () => {
    expect(periodLabel(parsePeriodKey('2019-01', 'ethiopian'), 'en')).toBe('Meskerem 2019');
    expect(periodLabel(parsePeriodKey('2019-01', 'ethiopian'), 'am')).toBe('መስከረም 2019');
    expect(periodLabel(parsePeriodKey('2026-10', 'gregorian'), 'en')).toBe('October 2026');
    expect(monthName({ month: 13, calendar: 'ethiopian' }, 'am')).toBe('ጳጉሜን');
  });
});

describe('date arithmetic that protects Pagume', () => {
  it('adds months across the 13-month Ethiopian year', () => {
    expect(addMonths(et(2019, 12, 30), 1)).toEqual(et(2019, 13, 6)); // clamped: Pagume 2019 has 6 days
    expect(addMonths(et(2020, 12, 30), 1)).toEqual(et(2020, 13, 5)); // common year: Pagume has 5 days
    expect(addMonths(et(2019, 13, 6), 1)).toEqual(et(2020, 1, 6));
    expect(addMonths(et(2019, 1, 15), 13)).toEqual(et(2020, 1, 15));
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays(et(2019, 13, 6), 1)).toEqual(et(2020, 1, 1));
    expect(addDays(et(2020, 1, 1), -1)).toEqual(et(2019, 13, 6));
    expect(differenceInDays(et(2019, 1, 1), et(2019, 13, 6))).toBe(365);
  });

  it('converts between calendars without drift', () => {
    expect(convertCivil(gc(2023, 9, 11), 'ethiopian')).toEqual(et(2015, 13, 6));
    expect(convertCivil(et(2015, 13, 6), 'gregorian')).toEqual(gc(2023, 9, 11));
    expect(convertCivil(gc(2024, 9, 11), 'ethiopian')).toEqual(et(2017, 1, 1));
  });
});
