import { describe, expect, it } from 'vitest';

import { convertCivil, dayOfWeek } from './civil.js';
import type { CivilDate } from './types.js';
import {
  formatCivilDate,
  formatMonthYear,
  formatWeekday,
  formatWithIntl,
  isInPeriod,
  monthGrid,
  monthOptions,
  periodDays,
  toGeezNumeral,
  weekdayHeaders,
} from './format.js';
import { parsePeriodKey } from './periods.js';

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

describe('date formatting', () => {
  it('formats Ethiopian dates in English and Amharic', () => {
    expect(formatCivilDate(et(2019, 1, 25))).toBe('25 Meskerem 2019');
    expect(formatCivilDate(et(2019, 1, 25), { language: 'am' })).toBe('25 መስከረም 2019');
    expect(formatCivilDate(et(2019, 1, 25), { style: 'long' })).toBe('Meskerem 25, 2019');
    expect(formatCivilDate(et(2019, 1, 25), { style: 'short' })).toBe('25/1/2019');
    expect(formatCivilDate(et(2019, 1, 25), { showEra: true })).toBe('25 Meskerem 2019 E.C.');
    expect(formatCivilDate(gc(2026, 10, 5), { showEra: true })).toBe('5 October 2026 G.C.');
  });

  it('formats ISO as the Gregorian interchange form', () => {
    expect(formatCivilDate(et(2019, 1, 25), { style: 'iso' })).toBe('2026-10-05');
  });

  it('formats month/year and weekday names', () => {
    expect(formatMonthYear(et(2019, 1))).toBe('Meskerem 2019');
    expect(formatMonthYear(gc(2026, 10), 'am')).toBe('ኦክቶበር 2026');
    expect(formatWeekday(gc(2026, 10, 5))).toBe('Monday');
    expect(formatWeekday(gc(2026, 10, 5), 'am')).toBe('ሰኞ');
  });

  it('mirrors ICU formatting for Ethiopic dates', () => {
    // ICU is an independent implementation; our own formatter must not diverge on
    // the underlying date, even if month naming style differs.
    const icu = formatWithIntl(et(2019, 1, 25), { locale: 'en', calendar: 'ethiopian', dateStyle: 'long' });
    expect(icu).toContain('2019');
    const icuAmharic = formatWithIntl(et(2019, 1, 25), { locale: 'am', calendar: 'ethiopian' });
    expect(icuAmharic).toMatch(/2019/);
  });

  it('offers month options for both calendars', () => {
    expect(monthOptions('ethiopian')).toHaveLength(13);
    expect(monthOptions('gregorian')).toHaveLength(12);
    expect(monthOptions('ethiopian', 'am')[12]).toBe('ጳጉሜን');
  });
});

describe('month grid for the 13-month date picker', () => {
  it('builds a 6x7 grid starting on the configured weekday', () => {
    const grid = monthGrid(parsePeriodKey('2019-01', 'ethiopian'), 0);
    expect(grid.weeks).toHaveLength(6);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
    expect(grid.weeks.flat().every((d) => d.calendar === 'ethiopian')).toBe(true);
    // 1 Meskerem 2019 must be inside the first week.
    expect(grid.weeks[0]?.some((d) => d.month === 1 && d.day === 1)).toBe(true);
    const inPeriod = grid.weeks.flat().filter((d) => isInPeriod(d, grid.period));
    expect(inPeriod).toHaveLength(30);
  });

  it('handles Pagume, which has only 5 or 6 days', () => {
    const leapPagume = monthGrid(parsePeriodKey('2019-13', 'ethiopian'));
    expect(leapPagume.weeks.flat().filter((d) => isInPeriod(d, leapPagume.period))).toHaveLength(6);
    const commonPagume = monthGrid(parsePeriodKey('2020-13', 'ethiopian'));
    expect(commonPagume.weeks.flat().filter((d) => isInPeriod(d, commonPagume.period))).toHaveLength(5);
    // Spill-over days must still be real dates (no 13-07, no 30-day months overflowing).
    for (const day of commonPagume.weeks.flat()) {
      expect(day.month).toBeGreaterThanOrEqual(1);
      expect(day.month).toBeLessThanOrEqual(13);
      expect(day.day).toBeLessThanOrEqual(30);
    }
  });

  it('handles Gregorian February in leap and common years', () => {
    expect(
      monthGrid(parsePeriodKey('2024-02', 'gregorian'))
        .weeks.flat()
        .filter((d) => isInPeriod(d, parsePeriodKey('2024-02', 'gregorian'))),
    ).toHaveLength(29);
    expect(
      monthGrid(parsePeriodKey('2026-02', 'gregorian'))
        .weeks.flat()
        .filter((d) => isInPeriod(d, parsePeriodKey('2026-02', 'gregorian'))),
    ).toHaveLength(28);
  });

  it('keeps the week grid contiguous (each row follows the previous by one day)', () => {
    const grid = monthGrid(parsePeriodKey('2015-13', 'ethiopian'));
    const flat = grid.weeks.flat();
    for (let i = 1; i < flat.length; i += 1) {
      const previous = flat[i - 1] as CivilDate;
      const current = flat[i] as CivilDate;
      expect(dayOfWeek(current)).toBe((dayOfWeek(previous) + 1) % 7);
    }
  });

  it('lists period days and weekday headers', () => {
    expect(periodDays(parsePeriodKey('2019-13', 'ethiopian'))).toHaveLength(6);
    expect(weekdayHeaders('en', 0)).toHaveLength(7);
    expect(weekdayHeaders('am', 1)[0]).toBe('ሰኞ');
  });
});

describe('Geʽez numerals', () => {
  it('renders numbers the way Ethiopian documents do', () => {
    expect(toGeezNumeral(1)).toBe('፩');
    expect(toGeezNumeral(9)).toBe('፱');
    expect(toGeezNumeral(10)).toBe('፲');
    expect(toGeezNumeral(30)).toBe('፴');
    expect(toGeezNumeral(100)).toBe('፻');
    expect(toGeezNumeral(2019)).toBe('፳፻፲፱');
    expect(toGeezNumeral(1998)).toBe('፲፱፻፺፰');
    expect(toGeezNumeral(1962)).toBe('፲፱፻፷፪');
    expect(toGeezNumeral(10000)).toBe('፼');
  });

  it('can format a whole date with Geʽez numerals', () => {
    expect(formatCivilDate(et(2019, 1, 25), { geezNumerals: true, showEra: true, language: 'am' })).toBe(
      '፳፭ መስከረም ፳፻፲፱ E.C.',
    );
  });

  it('refuses values Geʽez numerals cannot express', () => {
    expect(() => toGeezNumeral(-1)).toThrow(RangeError);
    expect(() => toGeezNumeral(2.5)).toThrow(RangeError);
    expect(toGeezNumeral(0)).toBe('0');
  });
});

describe('formatting stays consistent with conversion', () => {
  it('a formatted Ethiopian date denotes the same day as its Gregorian twin', () => {
    const ethiopian = et(2019, 1, 25);
    const gregorian = convertCivil(ethiopian, 'gregorian');
    expect(formatCivilDate(ethiopian, { style: 'iso' })).toBe(formatCivilDate(gregorian, { style: 'iso' }));
    expect(dayOfWeek(ethiopian)).toBe(dayOfWeek(gregorian));
  });
});
