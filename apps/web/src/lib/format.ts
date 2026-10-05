/**
 * Display formatting.
 *
 * The database holds Gregorian instants and integer minor units; everything a
 * human reads is produced here. Dates are converted with `@pms/calendar` at this
 * boundary only — no component is allowed to do calendar maths of its own.
 */

import {
  civilToUtcDate,
  formatCivilDate,
  formatMonthYear,
  fromIsoDate,
  todayIn,
  utcDateToCivil,
  type CalendarKind,
  type CivilDate,
  type LanguageCode,
} from '@pms/calendar';
import { formatMoney, money, parseMoneyInput } from '@pms/shared';

export interface DisplayOptions {
  language?: string;
  calendar?: CalendarKind;
  showEra?: boolean;
}

/** `Br 1,500.00` / `ብር 1,500.00` depending on the language. */
export function formatAmount(
  amountMinor: string | number | bigint,
  currency = 'ETB',
  language: string = 'en',
): string {
  return formatMoney(money(Number(amountMinor), currency), { language: language as LanguageCode });
}

/** Present a minor-unit string as a plain decimal for form inputs: `1500.00`. */
export function toInputAmount(amountMinor: string | number | bigint): string {
  return (Number(amountMinor) / 100).toFixed(2);
}

/** Parse `1,250.50`, `Br 1.250,50` or `1250` into minor units (throws on nonsense). */
export function fromInputAmount(input: string, currency = 'ETB'): number {
  return parseMoneyInput(input, currency).amountMinor;
}

/** A Gregorian instant rendered in the user's calendar, e.g. `25 Tir 2019 E.C.`. */
export function formatDate(instant: string | Date, options: DisplayOptions = {}): string {
  const { language = 'en', calendar = 'ethiopian', showEra = true } = options;
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const civil = utcDateToCivil(date, calendar);
  return formatCivilDate(civil, { language: language as LanguageCode, showEra });
}

/** A civil value (as returned by the server) rendered as a string. */
export function formatCivil(
  civil: { year: number; month: number; day: number; calendar: CalendarKind },
  options: DisplayOptions = {},
): string {
  return formatCivilDate(civil as CivilDate, {
    language: (options.language ?? 'en') as LanguageCode,
    showEra: options.showEra ?? true,
  });
}

/**
 * Both calendars side by side. Used wherever a date has legal weight — a lease
 * start, a due date — because the parties may each read a different one.
 */
export function formatDualDate(
  civil: { year: number; month: number; day: number; calendar: CalendarKind },
  language: string = 'en',
): string {
  const value = civil as CivilDate;
  const gregorian =
    value.calendar === 'gregorian' ? value : utcDateToCivil(civilToUtcDate(value), 'gregorian');
  const ethiopian =
    value.calendar === 'ethiopian' ? value : utcDateToCivil(civilToUtcDate(value), 'ethiopian');
  return `${formatCivilDate(ethiopian, { language: language as LanguageCode, showEra: true })} · ${formatCivilDate(
    gregorian,
    { language: language as LanguageCode, showEra: false },
  )} G.C.`;
}

export function todayFor(calendar: CalendarKind): CivilDate {
  return todayIn(calendar);
}

/** `2019-05` → `ግንቦት 2019` / `May 2019` — the header of a billing period. */
export function formatPeriodKey(periodKey: string, calendar: CalendarKind, language: string = 'en'): string {
  const [yearPart, monthPart] = periodKey.split('-');
  return formatMonthYear(
    { year: Number(yearPart), month: Number(monthPart), calendar },
    language as LanguageCode,
  );
}

/** ISO date (yyyy-mm-dd) for `<input type="date">`, always Gregorian. */
export function toIsoInput(civil: CivilDate): string {
  const gregorian =
    civil.calendar === 'gregorian' ? civil : utcDateToCivil(civilToUtcDate(civil), 'gregorian');
  return `${gregorian.year}-${String(gregorian.month).padStart(2, '0')}-${String(gregorian.day).padStart(2, '0')}`;
}

export function fromIsoInput(value: string, calendar: CalendarKind): CivilDate {
  return fromIsoDate(value, calendar);
}

export const statusTone: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  occupied: 'bg-brand-100 text-brand-800',
  paid: 'bg-brand-100 text-brand-800',
  completed: 'bg-brand-100 text-brand-800',
  sent: 'bg-brand-100 text-brand-800',
  draft: 'bg-slate-100 text-slate-700',
  vacant: 'bg-slate-100 text-slate-700',
  open: 'bg-amber-100 text-amber-800',
  partial: 'bg-amber-100 text-amber-800',
  pending: 'bg-amber-100 text-amber-800',
  queued: 'bg-amber-100 text-amber-800',
  assigned: 'bg-sky-100 text-sky-800',
  in_progress: 'bg-sky-100 text-sky-800',
  on_hold: 'bg-slate-200 text-slate-700',
  notice: 'bg-orange-100 text-orange-800',
  overdue: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-800',
  terminated: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-200 text-slate-600',
  waived: 'bg-slate-200 text-slate-700',
  reversed: 'bg-red-100 text-red-800',
};
