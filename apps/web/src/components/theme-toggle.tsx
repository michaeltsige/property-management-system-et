'use client';

import { useEffect } from 'react';

import { usePreferences } from '@/lib/preferences';
import { getResolvedTheme, initTheme, setThemeChoice } from '@/lib/theme';
import { cn } from '@/lib/utils';

import { Moon, Sun } from './icons';
import { Button } from './ui';

/**
 * The light/dark switch. One small icon button, dropped into the staff top
 * bar and the portal's rail + phone header.
 *
 * The two glyphs are swapped by CSS (`dark:`), not by React state: the button
 * renders correctly before hydration, costs no re-render, and can never fall
 * out of sync with the actual class on <html>. Clicking flips to the OTHER
 * explicit choice; a visitor who never clicks keeps following their OS.
 */
export function ThemeToggle({ className, rail = false }: { className?: string; rail?: boolean }) {
  const { t } = usePreferences();

  useEffect(() => {
    initTheme();
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('theme.toggle')}
      title={t('theme.toggle')}
      className={cn(rail && 'text-slate-300 hover:bg-white/10 hover:text-white', className)}
      onClick={() => setThemeChoice(getResolvedTheme() === 'dark' ? 'light' : 'dark')}
    >
      {/* Light mode: offer the dark side. Dark mode: offer the way back. */}
      <Moon className="block h-4 w-4 dark:hidden" aria-hidden="true" />
      <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
    </Button>
  );
}
