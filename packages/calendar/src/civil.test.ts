import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  civilToJdn,
  civilToUtcDate,
  clampDayOfMonth,
  compareCivil,
  convertCivil,
  dayOfWeek,
  daysInMonth,
  endOfMonth,
  fromIsoDate,
  isSameCivilDate,
  jdnToCivil,
  startOfMonth,
  toIsoDate,
  todayIn,
  utcDateToCivil,
} from './civil.js';
import type { CivilDate } from './types.js';

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

describe('civil date basics', () => {
  it('knows the length of every month', () => {
    expect(daysInMonth(et(2019, 13))).toBe(6);
    expect(daysInMonth(et(2020, 13))).toBe(5);
    expect(daysInMonth(gc(2024, 2))).toBe(29);
    expect(daysInMonth(gc(2026, 2))).toBe(28);
    expect(daysInMonth(gc(2026, 4))).toBe(30);
  });

  it('starts and ends months correctly', () => {
    expect(startOfMonth(et(2019, 1, 25))).toEqual(et(2019, 1, 1));
    expect(endOfMonth(et(2019, 1, 25))).toEqual(et(2019, 1, 30));
    expect(endOfMonth(et(2019, 13, 1))).toEqual(et(2019, 13, 6));
    expect(endOfMonth(gc(2024, 2, 1))).toEqual(gc(2024, 2, 29));
  });

  it('compares dates across calendars', () => {
    expect(isSameCivilDate(et(2019, 1, 25), gc(2026, 10, 5))).toBe(true);
    expect(compareCivil(gc(2026, 10, 5), et(2019, 1, 25))).toBe(0);
    expect(compareCivil(gc(2026, 10, 4), et(2019, 1, 25))).toBeLessThan(0);
    expect(compareCivil(gc(2026, 10, 6), et(2019, 1, 25))).toBeGreaterThan(0);
  });

  it('computes weekdays', () => {
    // 2026-10-05 is a Monday; Ethiopian 25 Meskerem 2019 is the same day.
    expect(dayOfWeek(gc(2026, 10, 5))).toBe(1);
    expect(dayOfWeek(et(2019, 1, 25))).toBe(1);
    expect(dayOfWeek(gc(2000, 1, 1))).toBe(6); // Saturday
    expect(dayOfWeek(gc(1970, 1, 1))).toBe(4); // Thursday
  });
});

describe('clamping days of month', () => {
  it('clamps to the real month length', () => {
    expect(clampDayOfMonth(et(2019, 13), 30)).toEqual(et(2019, 13, 6));
    expect(clampDayOfMonth(et(2020, 13), 1)).toEqual(et(2020, 13, 1));
    expect(clampDayOfMonth(gc(2024, 2), 30)).toEqual(gc(2024, 2, 29));
    expect(clampDayOfMonth(gc(2024, 3), 30)).toEqual(gc(2024, 3, 30));
  });

  it('rejects nonsense day numbers instead of silently guessing', () => {
    expect(() => clampDayOfMonth(gc(2024, 2), 0)).toThrow(RangeError);
    expect(() => clampDayOfMonth(gc(2024, 2), 1.5)).toThrow(RangeError);
  });
});

describe('UTC boundary conversion (the display/input rule)', () => {
  it('maps a civil date to UTC midnight of its Gregorian equivalent', () => {
    expect(civilToUtcDate(et(2019, 1, 25)).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(civilToUtcDate(gc(2026, 10, 5)).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(civilToUtcDate(et(2015, 13, 6)).toISOString()).toBe('2023-09-11T00:00:00.000Z');
  });

  it('reads UTC instants back into the requested calendar', () => {
    const instant = new Date('2026-10-05T09:30:00.000Z');
    expect(utcDateToCivil(instant, 'gregorian')).toEqual(gc(2026, 10, 5));
    expect(utcDateToCivil(instant, 'ethiopian')).toEqual(et(2019, 1, 25));
  });

  it('handles years below 100 without the Date.UTC pitfall', () => {
    const date = civilToUtcDate(gc(8, 9, 2));
    expect(date.getUTCFullYear()).toBe(8);
    expect(date.toISOString().slice(0, 10)).toBe('0008-09-02');
  });

  it('reports today in both calendars from an injected clock', () => {
    const now = new Date('2026-10-05T12:00:00.000Z');
    expect(todayIn('gregorian', now)).toEqual(gc(2026, 10, 5));
    expect(todayIn('ethiopian', now)).toEqual(et(2019, 1, 25));
  });
});

describe('ISO interchange', () => {
  it('writes ISO in Gregorian and reads it back in either calendar', () => {
    expect(toIsoDate(et(2019, 1, 25))).toBe('2026-10-05');
    expect(toIsoDate(gc(2026, 10, 5))).toBe('2026-10-05');
    expect(fromIsoDate('2026-10-05')).toEqual(gc(2026, 10, 5));
    expect(fromIsoDate('2026-10-05', 'ethiopian')).toEqual(et(2019, 1, 25));
  });

  it('rejects malformed or impossible ISO dates', () => {
    expect(() => fromIsoDate('05/10/2026')).toThrow(/ISO date/);
    expect(() => fromIsoDate('2026-02-30')).toThrow(/Not a real Gregorian date/);
  });
});

describe('JDN helpers agree with the periods module', () => {
  it('converts back and forth', () => {
    for (const civil of [gc(2026, 10, 5), et(2019, 1, 25), et(2015, 13, 6), gc(2024, 2, 29)]) {
      expect(jdnToCivil(civilToJdn(civil), civil.calendar)).toEqual(civil);
    }
  });

  it('adds days consistently in both calendars', () => {
    expect(addDays(gc(2024, 2, 28), 1)).toEqual(gc(2024, 2, 29));
    expect(addDays(gc(2025, 2, 28), 1)).toEqual(gc(2025, 3, 1));
    expect(addDays(et(2019, 1, 25), 7)).toEqual(et(2019, 2, 2));
    expect(addMonths(gc(2024, 12, 31), 1)).toEqual(gc(2025, 1, 31));
    expect(addMonths(gc(2024, 1, 31), 1)).toEqual(gc(2024, 2, 29));
  });

  it('converts a range of dates both ways without loss', () => {
    for (let day = 1; day <= 30; day += 1) {
      const ethiopian = et(2019, 5, day);
      const gregorian = convertCivil(ethiopian, 'gregorian');
      expect(convertCivil(gregorian, 'ethiopian')).toEqual(ethiopian);
    }
  });
});
