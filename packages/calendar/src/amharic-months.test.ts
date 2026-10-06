import { expect, it } from 'vitest';
import { monthName } from './civil.js';
it('uses Ethiopic script for all Amharic month labels in both calendars', () => {
  for (const calendar of ['ethiopian', 'gregorian'] as const) {
    for (let month = 1; month <= (calendar === 'ethiopian' ? 13 : 12); month++) {
      const text = monthName({ month, calendar }, 'am');
      expect(text).toMatch(/^[\u1200-\u137f]+$/);
      expect(text).not.toMatch(/[A-Za-z]/);
    }
  }
  expect(monthName({ month: 1, calendar: 'ethiopian' }, 'am')).toBe('መስከረም');
  expect(monthName({ month: 13, calendar: 'ethiopian' }, 'am')).toBe('ጳጉሜን');
});
