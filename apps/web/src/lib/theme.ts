'use client';

/**
 * Device-level light/dark preference.
 *
 * Three states, stored per device (never per account — same rule as the door
 * language): an explicit `light`/`dark` in localStorage under `pms.theme`, or
 * no key at all, which means "follow the OS" (`system`). The class lives on
 * `<html>` so plain CSS can react (`.dark { --color-canvas: … }` in
 * globals.css) and so `dark:` utilities work.
 *
 * First paint is already correct without this module: the inline script in
 * app/layout.tsx applies the class before any markup renders. This module
 * takes over from hydration onward — the toggle writes through it, charts
 * read the resolved theme through `useResolvedTheme`, and a `system` choice
 * keeps following the OS live.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'pms.theme';

let choice: ThemeChoice = 'system';
let systemDark = false;
let initialised = false;
const listeners = new Set<() => void>();

function resolve(): ResolvedTheme {
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  return choice;
}

function apply(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolve() === 'dark');
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Reads the stored choice and starts following the OS. Idempotent. */
export function initTheme(): void {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  systemDark = media.matches;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') choice = stored;

  media.addEventListener('change', (event) => {
    systemDark = event.matches;
    if (choice === 'system') {
      apply();
      emit();
    }
  });

  // The inline script already set the right class; re-applying is a no-op,
  // and it also covers the no-script edge (SSR render without JS).
  apply();
}

export function getThemeChoice(): ThemeChoice {
  return choice;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolve();
}

export function setThemeChoice(next: ThemeChoice): void {
  choice = next;
  if (typeof window !== 'undefined') {
    if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  }
  apply();
  emit();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** SSR-safe default keeps server and client markup identical. */
export const SERVER_RESOLVED_THEME: ResolvedTheme = 'light';
