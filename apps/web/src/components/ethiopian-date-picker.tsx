'use client';

/**
 * The 13-month date picker.
 *
 * The Ethiopian calendar has twelve 30-day months plus Pagume (5 days, 6 in a
 * leap year), so a Gregorian month grid cannot represent it. This picker draws
 * the real month lengths from `@pms/calendar` — including Pagume — and always
 * shows the equivalent date in the other calendar, because a rent due date has to
 * be unambiguous to both parties.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import {
  civilToUtcDate,
  compareCivil,
  daysInMonth,
  formatCivilDate,
  monthName,
  utcDateToCivil,
  todayIn,
  type CalendarKind,
  type CivilDate,
} from '@pms/calendar';

import { cn } from '@/lib/utils';
import { usePreferences } from '@/lib/preferences';

import { Button, Label } from './ui';

export interface DatePickerProps {
  value: CivilDate | null;
  onChange: (value: CivilDate) => void;
  /** Restrict the month grid (e.g. 13 for Pagume-only pickers). */
  maxYear?: number;
  minYear?: number;
  id?: string;
}

export function EthiopianDatePicker({
  value,
  onChange,
  minYear = 1900,
  maxYear = 2200,
  id,
}: DatePickerProps) {
  const { language, calendar, t } = usePreferences();
  const selected = value ?? todayIn(calendar);

  // `selected` is derived from `value`/`calendar`; the primitives below are the
  // real dependencies and keep the memo honest.
  const { year: selectedYear, month: selectedMonth, day: selectedDay, calendar: selectedCalendar } = selected;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => daysInMonth(selected), [selectedYear, selectedMonth, selectedCalendar]);
  const monthNames = useMemo(
    () => Array.from({ length: calendar === 'ethiopian' ? 13 : 12 }, (_, index) => index + 1),
    [calendar],
  );

  const converted = useMemo(() => {
    const other: CalendarKind = selected.calendar === 'ethiopian' ? 'gregorian' : 'ethiopian';
    return utcDateToCivil(civilToUtcDate(selected), other);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth, selectedDay, selectedCalendar]);

  function select(year: number, month: number, day: number) {
    const maxDay = daysInMonth({ year, month, calendar });
    onChange({ year, month, day: Math.min(day, maxDay), calendar });
  }

  function shiftMonth(delta: number) {
    const perYear = calendar === 'ethiopian' ? 13 : 12;
    const index = selected.year * perYear + (selected.month - 1) + delta;
    const year = Math.floor(index / perYear);
    const month = (((index % perYear) + perYear) % perYear) + 1;
    select(year, month, selected.day);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => shiftMonth(-1)}
          aria-label={t('common.previous')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-900">
            {monthName(selected, language)} {selected.year}
            {calendar === 'ethiopian' ? ' E.C.' : ' G.C.'}
          </p>
          <p className="text-[11px] text-slate-500">
            {formatCivilDate(converted, { language })}
            {converted.calendar === 'ethiopian' ? ' E.C.' : ' G.C.'}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => shiftMonth(1)}
          aria-label={t('common.next')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-2 grid grid-cols-4 gap-1 sm:grid-cols-7">
        {monthNames.map((month) => {
          const isSelected = month === selected.month;
          const isPagume = calendar === 'ethiopian' && month === 13;
          return (
            <button
              key={month}
              type="button"
              onClick={() => select(selected.year, month, selected.day)}
              className={cn(
                'truncate rounded-md border px-1 py-1 text-[11px]',
                isSelected
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : isPagume
                    ? 'border-gold-400 bg-gold-400/10 text-gold-600'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
              title={monthName({ month, calendar }, language)}
            >
              {monthName({ month, calendar }, language).slice(0, 3)}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: days }, (_, index) => index + 1).map((day) => {
          const isSelected = day === selected.day;
          const isToday = compareCivil({ ...selected, day }, todayIn(calendar)) === 0;
          return (
            <button
              key={day}
              type="button"
              onClick={() => select(selected.year, selected.month, day)}
              className={cn(
                'tabular rounded-md border px-0 py-1 text-xs',
                isSelected
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800'
                  : isToday
                    ? 'border-gold-400 text-gold-600'
                    : 'border-transparent text-slate-700 hover:bg-slate-100',
              )}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <Label htmlFor={id ? `${id}-year` : undefined} className="text-xs">
          {t('common.year')}
        </Label>
        <input
          id={id ? `${id}-year` : undefined}
          type="number"
          value={selected.year}
          min={minYear}
          max={maxYear}
          onChange={(event) => select(Number(event.target.value), selected.month, selected.day)}
          className="h-8 w-24 rounded-md border border-slate-200 px-2 text-xs"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            const today = todayIn(calendar);
            select(today.year, today.month, today.day);
          }}
        >
          {t('common.today')}
        </Button>
      </div>
    </div>
  );
}

/**
 * A compact trigger that shows the selected date in both calendars, and opens
 * the picker in a native `<dialog>` (no extra dependency, keyboard accessible).
 */
export function DateField({
  value,
  onChange,
  label,
  required,
}: {
  value: CivilDate | null;
  onChange: (value: CivilDate) => void;
  label: string;
  required?: boolean;
}) {
  const { language, calendar } = usePreferences();
  const selected = value ?? todayIn(calendar);

  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      <details className="rounded-md border border-slate-200">
        <summary className="cursor-pointer list-none px-3 py-2 text-sm text-slate-800">
          {formatCivilDate(selected, { language, showEra: true })} ·{' '}
          {formatCivilDate(utcDateToCivil(civilToUtcDate(selected), 'gregorian'), { language })} G.C.
        </summary>
        <div className="border-t border-slate-100 p-2">
          <EthiopianDatePicker value={selected} onChange={onChange} />
        </div>
      </details>
    </div>
  );
}
