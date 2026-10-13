'use client';

/**
 * Organization settings, fetched once and shared app-wide.
 *
 * Pages used to each call `api.settings()` on mount, so changing the billing
 * calendar in settings left every other screen on the old value until a full
 * reload. One provider, one `reload()`: the organization screen saves, calls
 * `reload()`, and every consumer — lease defaults, dashboard, pickers — sees
 * the new value immediately.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CalendarKind } from '@pms/calendar';

import { api } from './api';
import { usePreferences } from './preferences';

export interface OrgSettingsState {
  settings: Record<string, unknown> | null;
  /** The calendar new leases are billed in (org default; existing leases keep theirs). */
  billingCalendar: CalendarKind;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const OrgSettingsContext = createContext<OrgSettingsState | null>(null);

function calendarOf(value: unknown): CalendarKind {
  return value === 'gregorian' ? 'gregorian' : 'ethiopian';
}

export function OrgSettingsProvider({ children }: { children: ReactNode }) {
  const { session } = usePreferences();
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const orgId = session?.organization.id ?? null;

  useEffect(() => {
    if (!orgId) {
      setSettings(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .settings()
      .then((payload) => {
        if (!cancelled) {
          setSettings(payload.settings);
          setError(null);
        }
      })
      .catch(() => {
        // Keep the last known settings on transient failures; the next reload
        // retries. Nothing on screen hard-depends on a fresh value.
        if (!cancelled) setError('settings_unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  const value = useMemo<OrgSettingsState>(
    () => ({
      settings,
      billingCalendar: calendarOf(settings?.defaultBillingCalendar),
      loading,
      error,
      reload,
    }),
    [settings, loading, error, reload],
  );

  return <OrgSettingsContext.Provider value={value}>{children}</OrgSettingsContext.Provider>;
}

export function useOrgSettings(): OrgSettingsState {
  const context = useContext(OrgSettingsContext);
  if (!context) throw new Error('useOrgSettings must be used inside <OrgSettingsProvider>');
  return context;
}
