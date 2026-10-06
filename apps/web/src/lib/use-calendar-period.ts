'use client';
import { useState } from 'react';
import { todayIn, type CalendarKind } from '@pms/calendar';

/** A period key has meaning only in its own calendar, including month 13. */
export function useCalendarPeriod(calendar: CalendarKind) {
  const [selected, setSelected] = useState<Partial<Record<CalendarKind, string>>>({});
  const today = todayIn(calendar);
  const periodKey = selected[calendar] ?? `${today.year}-${String(today.month).padStart(2, '0')}`;
  const setPeriodKey = (key: string) => setSelected((current) => ({ ...current, [calendar]: key }));
  return [periodKey, setPeriodKey] as const;
}
