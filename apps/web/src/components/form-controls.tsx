'use client';

/**
 * Form controls that encode Ethiopian-specific input rules:
 * `MoneyInput` parses `Br 1.250,50`-style text into minor units, and
 * `PeriodPicker` selects a billing period in the calendar the lease uses (13
 * months for Ethiopian leases, including Pagume).
 */

import { useId, useMemo, useState } from 'react';

import { daysInMonth, monthName, todayIn, type CalendarKind } from '@pms/calendar';

import { fromInputAmount, toInputAmount } from '@/lib/format';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { Button, Input, Label, Select } from './ui';

export function MoneyInput({
  value,
  onChange,
  currency = 'ETB',
  label,
  required,
  id,
}: {
  /** Minor units, or null when empty. */
  value: number | null;
  onChange: (amountMinor: number | null) => void;
  currency?: string;
  label: string;
  required?: boolean;
  id?: string;
}) {
  const { t } = usePreferences();
  // Without an explicit id the label would float next to an unlabelled input;
  // `useId` is stable across server and client rendering.
  const generatedId = useId();
  const inputId = id ?? `money-${generatedId}`;
  const [text, setText] = useState(value === null ? '' : toInputAmount(value));
  const [error, setError] = useState<string | null>(null);

  function commit(next: string) {
    setText(next);
    if (next.trim() === '') {
      setError(null);
      onChange(null);
      return;
    }
    try {
      onChange(fromInputAmount(next, currency));
      setError(null);
    } catch {
      setError(t('error.invalid_amount'));
      onChange(null);
    }
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={inputId}>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">
          {currency === 'ETB' ? 'Br' : currency}
        </span>
        <Input
          id={inputId}
          aria-describedby={`${inputId}-hint`}
          inputMode="decimal"
          className="pl-9 tabular"
          placeholder="1,500.00"
          value={text}
          onChange={(event) => commit(event.target.value)}
        />
      </div>
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-[11px] text-slate-500" id={`${inputId}-hint`}>
        {currency} · {t('money.amount')}
      </p>
    </div>
  );
}

export function PeriodPicker({
  periodKey,
  onChange,
  calendar,
  months = 24,
  label,
}: {
  periodKey: string;
  onChange: (periodKey: string) => void;
  calendar: CalendarKind;
  months?: number;
  label?: string;
}) {
  const { language, t } = usePreferences();
  const monthsPerYear = calendar === 'ethiopian' ? 13 : 12;

  const options = useMemo(() => {
    const today = todayIn(calendar);
    const list: { key: string; label: string }[] = [];
    for (let offset = 0; offset < months; offset += 1) {
      const index = today.year * monthsPerYear + (today.month - 1) - offset;
      const year = Math.floor(index / monthsPerYear);
      const month = (((index % monthsPerYear) + monthsPerYear) % monthsPerYear) + 1;
      list.push({
        key: `${year}-${String(month).padStart(2, '0')}`,
        label: `${monthName({ month, calendar }, language)} ${year}`,
      });
    }
    return list;
  }, [calendar, months, monthsPerYear, language]);

  return (
    <div className="flex items-center gap-2">
      {label ? <span className="text-xs text-slate-500">{label}</span> : null}
      <Select
        value={periodKey}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-44 text-xs"
        aria-label={t('reports.period')}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Year/month/day steppers for the 13-month calendar, used by filters. */
export function MonthAccordion({
  calendar,
  onPick,
}: {
  calendar: CalendarKind;
  onPick: (periodKey: string) => void;
}) {
  const { language } = usePreferences();
  const today = todayIn(calendar);
  const [year, setYear] = useState(today.year);
  const months = calendar === 'ethiopian' ? 13 : 12;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setYear(year - 1)}>
          {year - 1}
        </Button>
        <span className="text-sm font-semibold text-slate-800">
          {year}
          {calendar === 'ethiopian' ? ' E.C.' : ' G.C.'}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setYear(year + 1)}>
          {year + 1}
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-1 sm:grid-cols-7">
        {Array.from({ length: months }, (_, index) => index + 1).map((month) => {
          const isPagume = calendar === 'ethiopian' && month === 13;
          return (
            <button
              key={month}
              type="button"
              onClick={() => onPick(`${year}-${String(month).padStart(2, '0')}`)}
              className={cn(
                'rounded-md border px-1 py-1 text-[11px]',
                isPagume
                  ? 'border-gold-400 text-gold-600'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
              title={`${daysInMonth({ year, month, calendar })} days`}
            >
              {monthName({ month, calendar }, language).slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
