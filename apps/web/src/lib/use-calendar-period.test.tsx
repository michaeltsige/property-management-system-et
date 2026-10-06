import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { todayIn, type CalendarKind } from '@pms/calendar';
import { useCalendarPeriod } from './use-calendar-period';
import { formatPeriodKey } from './format';
describe('calendar-owned period state', () => {
  it('switches away from Pagume synchronously, preserving the original selection on return', () => {
    const { result, rerender } = renderHook(
      ({ calendar }: { calendar: CalendarKind }) => useCalendarPeriod(calendar),
      { initialProps: { calendar: 'ethiopian' as CalendarKind } },
    );
    act(() => result.current[1]('2018-13'));
    expect(() => formatPeriodKey(result.current[0], 'ethiopian')).not.toThrow();
    rerender({ calendar: 'gregorian' });
    const today = todayIn('gregorian');
    expect(result.current[0]).toBe(`${today.year}-${String(today.month).padStart(2, '0')}`);
    expect(() => formatPeriodKey(result.current[0], 'gregorian')).not.toThrow();
    act(() => result.current[1]('2026-02'));
    rerender({ calendar: 'ethiopian' });
    expect(result.current[0]).toBe('2018-13');
    rerender({ calendar: 'gregorian' });
    expect(result.current[0]).toBe('2026-02');
  });
});

it('reproduces why a retained Pagume key must never be relabeled Gregorian', () => {
  expect(() => formatPeriodKey('2018-13', 'gregorian')).toThrow();
  expect(() => formatPeriodKey('2018-13', 'ethiopian')).not.toThrow();
});
