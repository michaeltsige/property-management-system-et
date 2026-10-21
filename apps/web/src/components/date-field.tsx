'use client';

/**
 * The one date picker, for both calendars.
 *
 * A real weekday-aligned month grid: `@pms/calendar#monthGrid` already produced
 * a tested 6x7 grid (Pagume included, spill-over days preserved) — this renders
 * it in a popover. Which calendar the grid shows is a prop: lease dates are
 * entered in the organization's billing calendar, everything else follows the
 * viewer's display preference. The equivalent date in the other calendar is
 * always visible, because a rent due date has to be unambiguous to both parties.
 */

import { ArrowLeft2, ArrowRight2, Calendar } from './icons';
import { useMemo, useState } from 'react';

import {
  civilToUtcDate,
  compareCivil,
  convertCivil,
  formatCivilDate,
  formatMonthYear,
  isInPeriod,
  monthGrid,
  nextPeriod,
  periodEnd,
  periodForDate,
  periodLabel,
  periodStart,
  previousPeriod,
  todayIn,
  utcDateToCivil,
  weekdayHeaders,
  type BillingPeriod,
  type CalendarKind,
  type CivilDate,
  type LanguageCode,
} from '@pms/calendar';

import { cn } from '@/lib/utils';
import { usePreferences } from '@/lib/preferences';

import { Button, Label, Popover, Select } from './ui';

/** Roughly the range a lease office works in; the year dropdown can reach it. */
const YEAR_WINDOW = 15;

function otherCalendar(calendar: CalendarKind): CalendarKind {
  return calendar === 'ethiopian' ? 'gregorian' : 'ethiopian';
}

function suffixOf(calendar: CalendarKind): string {
  return calendar === 'ethiopian' ? 'E.C.' : 'G.C.';
}

/** The equivalent date in the other calendar, always visible next to the main one. */
function dual(civil: CivilDate, language: LanguageCode): string {
  const converted = utcDateToCivil(civilToUtcDate(civil), otherCalendar(civil.calendar));
  return `${formatCivilDate(converted, { language })} ${suffixOf(converted.calendar)}`;
}

/**
 * The viewed month in the OTHER calendar — as a range, not a single day.
 *
 * The calendars are offset (the Ethiopian year starts around September 11), so
 * the first day of a Gregorian month lands mid-Ethiopian-month and vice versa:
 * a one-day label read like a random unrelated date while paging through
 * months. A month is only ever ONE other-calendar month wide + a day or two,
 * so the range is short and it makes the offset visible instead of confusing.
 */
function dualRange(period: BillingPeriod, language: LanguageCode): string {
  const other = otherCalendar(period.calendar);
  const start = convertCivil(periodStart(period), other);
  const end = convertCivil(periodEnd(period), other);
  const suffix = suffixOf(other);
  if (start.month === end.month && start.year === end.year) {
    return `${formatMonthYear(start, language)} ${suffix}`;
  }
  return `${formatCivilDate(start, { language })} – ${formatCivilDate(end, { language })} ${suffix}`;
}

export interface DateFieldProps {
  value: CivilDate | null;
  onChange: (value: CivilDate) => void;
  label?: string;
  required?: boolean;
  id?: string;
  /** Which calendar the grid shows. Defaults to the viewer's display calendar. */
  calendar?: CalendarKind;
  disabled?: boolean;
}

export function DateField({ value, onChange, label, required, id, calendar, disabled }: DateFieldProps) {
  const { language, calendar: displayCalendar, t } = usePreferences();
  const viewCalendar = calendar ?? displayCalendar;
  const [open, setOpen] = useState(false);
  // The month being browsed. Seeded from the value (or today) each time the
  // popover opens, so reopening never lands the user in a stale month.
  const [viewPeriod, setViewPeriod] = useState<BillingPeriod>(() => periodForDate(todayIn(viewCalendar)));

  const selected = useMemo(() => {
    if (!value) return null;
    // A stored value may come from the other calendar (e.g. the org switched the
    // billing calendar); normalize so comparisons and highlighting work.
    return utcDateToCivil(civilToUtcDate(value), viewCalendar);
  }, [value, viewCalendar]);

  function openPicker() {
    setViewPeriod(periodForDate(selected ?? todayIn(viewCalendar)));
    setOpen(true);
  }

  function pick(civil: CivilDate) {
    onChange(civil);
    setOpen(false);
  }

  const grid = useMemo(() => monthGrid(viewPeriod, 0), [viewPeriod]);
  const headers = useMemo(() => weekdayHeaders(language, 0), [language]);
  const today = todayIn(viewCalendar);

  const years = useMemo(() => {
    const base = today.year;
    return Array.from({ length: YEAR_WINDOW * 2 + 1 }, (_, index) => base - YEAR_WINDOW + index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewCalendar, open]);

  return (
    <div className="space-y-1">
      {label ? (
        <Label htmlFor={id}>
          {label}
          {required ? <span className="text-red-600 dark:text-red-400"> *</span> : null}
        </Label>
      ) : null}
      <Popover
        open={open}
        onOpenChange={(next) => (next ? openPicker() : setOpen(false))}
        ariaLabel={label ?? t('calendar.select_date')}
        trigger={
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={cn(
              'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 text-left text-sm shadow-sm transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
              'disabled:cursor-not-allowed disabled:bg-wash disabled:text-faint',
            )}
          >
            <span className="min-w-0 truncate">
              {selected ? (
                <>
                  <span className="text-strong">
                    {formatCivilDate(selected, { language, showEra: true })} {suffixOf(selected.calendar)}
                  </span>
                  <span className="ml-2 text-xs text-muted">{dual(selected, language)}</span>
                </>
              ) : (
                <span className="text-faint">{t('calendar.select_date')}</span>
              )}
            </span>
            <Calendar className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
          </button>
        }
      >
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setViewPeriod(previousPeriod(viewPeriod))}
              aria-label={t('calendar.previous_month')}
            >
              <ArrowLeft2 className="h-4 w-4" />
            </Button>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-semibold text-strong">
                {periodLabel(viewPeriod, language)} {viewPeriod.year}
                {' '}
                {suffixOf(viewPeriod.calendar)}
              </p>
              <p className="truncate text-[11px] text-soft">
                {dualRange(viewPeriod, language)}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setViewPeriod(nextPeriod(viewPeriod))}
              aria-label={t('calendar.next_month')}
            >
              <ArrowRight2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1">
            {headers.map((header) => (
              <div key={header} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted">
                {header}
              </div>
            ))}
          </div>

          <div role="grid" className="space-y-1">
            {grid.weeks.map((week, weekIndex) => (
              <div key={weekIndex} role="row" className="grid grid-cols-7 gap-1">
                {week.map((civil) => {
                  const inMonth = isInPeriod(civil, viewPeriod);
                  const isSelectedDay = selected !== null && compareCivil(civil, selected) === 0;
                  const isToday = compareCivil(civil, today) === 0;
                  return (
                    <button
                      key={`${civil.year}-${civil.month}-${civil.day}`}
                      type="button"
                      role="gridcell"
                      aria-selected={isSelectedDay}
                      onClick={() => (inMonth ? pick(civil) : setViewPeriod(periodForDate(civil)))}
                      className={cn(
                        'tabular rounded-md py-1.5 text-xs transition-colors',
                        inMonth ? 'text-body' : 'text-faint',
                        inMonth && 'hover:bg-brand-50',
                        isSelectedDay
                          ? 'bg-brand-600 font-semibold text-white hover:bg-brand-600'
                          : isToday
                            ? 'border border-gold-400 text-gold-700 dark:text-gold-400'
                            : 'border border-transparent',
                      )}
                    >
                      {civil.day}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-line-soft pt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => pick(today)}
              className="mr-auto"
            >
              {t('calendar.today')}
            </Button>
            <Label htmlFor={id ? `${id}-year` : 'date-field-year'} className="text-xs">
              {t('calendar.year')}
            </Label>
            <Select
              id={id ? `${id}-year` : 'date-field-year'}
              value={String(viewPeriod.year)}
              onChange={(event) => {
                const year = Number(event.target.value);
                if (!Number.isFinite(year)) return;
                setViewPeriod({ calendar: viewCalendar, year, month: viewPeriod.month, key: `${year}-${String(viewPeriod.month).padStart(2, '0')}` });
              }}
              className="h-8 w-28 text-xs"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Popover>
    </div>
  );
}
