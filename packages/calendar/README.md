# @pms/calendar

Ethiopian ↔ Gregorian calendar arithmetic for the property-management system.

## Rules this package enforces

- **Everything in the database is UTC/Gregorian.** Conversion happens only at the
  display/input boundary, in this package.
- Dates are handled as _date-only_ values (civil dates), never as local times.
  Ethiopia is UTC+03:00 all year and observes no daylight saving, so
  "UTC midnight" is a safe date-only representation.
- The Ethiopian calendar has 13 months: 12 × 30 days plus **Pagume** (5 days, or 6
  in a leap year). A year is leap when `year mod 4 === 3`.

## Verified math, not folklore

`ETHIOPIAN_EPOCH_JDN = 1724221` (1 Meskerem 1 E.C. = 29 August 8 C.E., Julian).
`ethiopian.test.ts`:

- round-trips every day between 1900-01-01 and 2100-12-31 through
  JDN → Ethiopian → JDN;
- cross-checks conversions against ICU's `ethiopic` calendar (`Intl.DateTimeFormat`)
  for ~200 sampled dates — an independent implementation;
- asserts Pagume 5 vs 6 for leap and common years, and Ethiopian New Year anchors.

## Main entry points

```ts
import { ethiopian, periods, format } from '@pms/calendar';

ethiopian.todayIn('ethiopian'); // { year, month, day, calendar }
ethiopian.ethiopianToJdn({ year: 2019, month: 1, day: 25 });
periods.periodForDate({ year: 2019, month: 1, day: 25, calendar: 'ethiopian' });
periods.dueDateForPeriod(period, 5); // clamped to the month's real length
format.formatCivilDate(civil, { locale: 'am', style: 'long' });
format.monthGrid(period); // 6x7 grid for the 13-month date picker
```
