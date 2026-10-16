'use client';

/**
 * The language switcher shown on the sign-in doors (staff and tenant).
 *
 * A signed-out door has no account behind it, so the language there is a
 * device-level choice: it is remembered on this device (`pms.door-language`
 * in preferences.tsx) and it is always visible, so any visitor can reach
 * their language in one tap instead of inheriting the previous visitor's.
 * The account's own preference takes over the moment they sign in.
 */

import type { LanguageCode } from '@pms/calendar';

import { LANGUAGES, usePreferences } from '@/lib/preferences';

export function DoorLanguagePicker() {
  const { language, setLanguage, t } = usePreferences();
  return (
    <div className="absolute right-4 top-4 z-10">
      <label htmlFor="door-language" className="sr-only">
        {t('preferences.language')}
      </label>
      <select
        id="door-language"
        value={language}
        onChange={(event) => setLanguage(event.target.value as LanguageCode)}
        className="rounded-full border border-white/30 bg-ink-950/40 py-1.5 pl-3 pr-2 text-xs font-medium text-white shadow-float backdrop-blur-sm transition-colors hover:bg-ink-950/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {LANGUAGES.map((option) => (
          <option key={option.code} value={option.code} className="text-slate-900">
            {option.label} · {option.english}
          </option>
        ))}
      </select>
    </div>
  );
}
