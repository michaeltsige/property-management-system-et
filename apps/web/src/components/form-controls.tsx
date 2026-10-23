'use client';

/**
 * Form controls that encode Ethiopian-specific input rules:
 * `MoneyInput` parses `Br 1.250,50`-style text into minor units, and
 * `PeriodPicker` selects a billing period in the calendar the lease uses (13
 * months for Ethiopian leases, including Pagume).
 */

import { useId, useMemo, useState } from 'react';

import { monthName, todayIn, type CalendarKind } from '@pms/calendar';

import { fromInputAmount, toInputAmount } from '@/lib/format';
import { usePreferences } from '@/lib/preferences';

import { Input, Label, Select } from './ui';

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
        {required ? <span className="text-red-600 dark:text-red-400"> *</span> : null}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
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
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-[11px] text-muted" id={`${inputId}-hint`}>
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
  /** How many future months the list offers (advance/prepaid cycles need them). */
  futureMonths = 0,
  label,
}: {
  periodKey: string;
  onChange: (periodKey: string) => void;
  calendar: CalendarKind;
  months?: number;
  futureMonths?: number;
  label?: string;
}) {
  const { language, t } = usePreferences();
  const monthsPerYear = calendar === 'ethiopian' ? 13 : 12;

  const options = useMemo(() => {
    const today = todayIn(calendar);
    const list: { key: string; label: string }[] = [];
    // Offsets run from `futureMonths` ahead back to `months - 1` behind; the
    // list renders newest first.
    for (let offset = -futureMonths; offset < months; offset += 1) {
      const index = today.year * monthsPerYear + (today.month - 1) - offset;
      const year = Math.floor(index / monthsPerYear);
      const month = (((index % monthsPerYear) + monthsPerYear) % monthsPerYear) + 1;
      list.push({
        key: `${year}-${String(month).padStart(2, '0')}`,
        label: `${monthName({ month, calendar }, language)} ${year}`,
      });
    }
    return list;
  }, [calendar, months, futureMonths, monthsPerYear, language]);

  return (
    <div className="flex items-center gap-2">
      {label ? <span className="text-xs text-muted">{label}</span> : null}
      <Select
        value={periodKey}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full text-xs sm:w-44"
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
