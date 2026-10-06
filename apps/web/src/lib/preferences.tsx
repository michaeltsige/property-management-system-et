'use client';

/**
 * Session, language and calendar preferences.
 *
 * The organization supplies the defaults; a user may override the calendar and
 * the language for themselves. Preferences live in `localStorage` and travel to
 * the API only when they change something on the server (never per request), so
 * switching calendar is instant and works offline.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTranslator, type TranslationOverride, type Translator } from '@pms/i18n';
import type { CalendarKind, LanguageCode } from '@pms/calendar';

import {
  SESSION_EXPIRED_EVENT,
  api,
  loadSession,
  saveSession,
  updateStoredSession,
  type StoredSession,
} from './api';

export const LANGUAGES: { code: LanguageCode; label: string; english: string }[] = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'am', label: 'አማርኛ', english: 'Amharic' },
  { code: 'om', label: 'Afaan Oromoo', english: 'Afaan Oromo' },
  { code: 'ti', label: 'ትግርኛ', english: 'Tigrinya' },
];

export const CALENDARS: { code: CalendarKind; label: string; english: string }[] = [
  { code: 'ethiopian', label: 'ኢትዮጵያ', english: 'Ethiopian' },
  { code: 'gregorian', label: 'Gregorian', english: 'Gregorian' },
];

interface PreferenceState {
  session: StoredSession | null;
  language: LanguageCode;
  calendar: CalendarKind;
  t: Translator['t'];
  translate: Translator;
  setLanguage: (language: LanguageCode) => void;
  setCalendar: (calendar: CalendarKind) => void;
  signIn: (session: StoredSession) => void;
  signOut: () => void;
  refreshOverrides: () => Promise<void>;
  ready: boolean;
}

const PreferenceContext = createContext<PreferenceState | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const [overrides, setOverrides] = useState<TranslationOverride[]>([]);
  const [language, setLanguageState] = useState<LanguageCode>('en');
  const [calendar, setCalendarState] = useState<CalendarKind>('ethiopian');

  // Restore on mount: localStorage is not available during server rendering.
  // The stored session is a display cache, so it is verified against the server —
  // the cookies are the real session and this code cannot read them (ADR-0026).
  useEffect(() => {
    const stored = loadSession();
    setSession(stored);
    if (stored) {
      setLanguageState(stored.user.language);
      setCalendarState(stored.user.calendar);
    }
    setReady(true);

    if (!stored) return;
    let cancelled = false;
    void api
      .me()
      .then(() => undefined)
      .catch(() => {
        // 401 already cleared the stored session; anything else (API down) keeps
        // the user where they are and lets the next request decide.
        if (!cancelled) setSession(loadSession());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A 401 that survives the server-side refresh ends the session wherever it was
  // noticed — including inside a screen's data fetch, hence the event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onExpired = () => {
      setSession(null);
      setOverrides([]);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const refreshOverrides = useCallback(async () => {
    if (!session) return;
    try {
      const response = await fetch(`/api/v1/translations?language=${language}`, {
        // The session cookie is HttpOnly; this code has no token to attach.
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        rows: { key: string; current: string; status: string; source: string }[];
      };
      // Only rows that came from an override are sent to the translator; shipped
      // catalog text is already in the bundle.
      setOverrides(
        payload.rows
          .filter((row) => row.source === 'organization_override' || row.source === 'global_override')
          .map((row) => ({
            key: row.key,
            language,
            text: row.current,
            organizationId: row.source === 'organization_override' ? (session.organization.id ?? null) : null,
            status: (['machine_draft', 'unreviewed', 'reviewed'].includes(row.status)
              ? row.status
              : 'unreviewed') as 'machine_draft' | 'unreviewed' | 'reviewed',
          })) as TranslationOverride[],
      );
    } catch {
      // Offline or the API is down: fall back to the shipped catalogs.
    }
  }, [language, session]);

  useEffect(() => {
    void refreshOverrides();
  }, [refreshOverrides]);

  const translator = useMemo(
    () =>
      createTranslator({
        language,
        organizationId: session?.organization.id ?? null,
        overrides,
      }),
    [language, overrides, session?.organization.id],
  );

  const setLanguage = useCallback((next: LanguageCode) => {
    setLanguageState(next);
    document.documentElement.lang = next;
    const updated = updateStoredSession({
      user: { ...(loadSession()?.user as StoredSession['user']), language: next },
    });
    if (updated) setSession(updated);
  }, []);

  const setCalendar = useCallback((next: CalendarKind) => {
    setCalendarState(next);
    const current = loadSession();
    if (current) {
      const updated = updateStoredSession({ user: { ...current.user, calendar: next } });
      if (updated) setSession(updated);
    }
  }, []);

  const signIn = useCallback((next: StoredSession) => {
    saveSession(next);
    setSession(next);
    setLanguageState(next.user.language);
    setCalendarState(next.user.calendar);
  }, []);

  const signOut = useCallback(() => {
    saveSession(null);
    setSession(null);
    setOverrides([]);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<PreferenceState>(
    () => ({
      session,
      language,
      calendar,
      t: translator.t,
      translate: translator,
      setLanguage,
      setCalendar,
      signIn,
      signOut,
      refreshOverrides,
      ready,
    }),
    [
      session,
      language,
      calendar,
      translator,
      setLanguage,
      setCalendar,
      signIn,
      signOut,
      refreshOverrides,
      ready,
    ],
  );

  return <PreferenceContext.Provider value={value}>{children}</PreferenceContext.Provider>;
}

export function usePreferences(): PreferenceState {
  const context = useContext(PreferenceContext);
  if (!context) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return context;
}
