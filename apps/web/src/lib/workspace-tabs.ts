'use client';

import { useSyncExternalStore } from 'react';

/**
 * Workspace tabs: the routes the user has open, persisted across reloads.
 * The store is presentation state only — closing a tab never touches data,
 * and the API permissions still decide what each screen can show.
 */
const STORAGE_KEY = 'pms.workspace-tabs.v1';
const CHANGE_EVENT = 'pms-workspace-tabs';
export const MAX_TABS = 8;

const EMPTY: string[] = [];
let cache: { raw: string; tabs: string[] } = { raw: '', tabs: EMPTY };

/**
 * `useSyncExternalStore` compares snapshots by identity, so parsing on every
 * call would rerender forever; the cache only swaps arrays when storage did.
 */
function readStored(): string[] {
  if (typeof window === 'undefined') return EMPTY;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if ((raw ?? '') === cache.raw) return cache.tabs;
  let tabs: string[] = EMPTY;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const strings = parsed.filter((entry): entry is string => typeof entry === 'string');
        if (strings.length > 0) tabs = strings;
      }
    } catch {
      tabs = EMPTY;
    }
  }
  cache = { raw: raw ?? '', tabs };
  return cache.tabs;
}

function write(tabs: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Storage can be denied in private windows; the in-memory view still works.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function getWorkspaceTabs(): string[] {
  return readStored();
}

/**
 * New tabs append at the end; opening a tab that is already open changes
 * nothing — the list order is the user's, and clicking around must never
 * shuffle it.
 */
export function openWorkspaceTab(path: string): void {
  const tabs = readStored();
  if (tabs.includes(path)) return;
  write([...tabs, path].slice(-MAX_TABS));
}

export function closeWorkspaceTab(path: string): string | null {
  const tabs = readStored();
  const index = tabs.indexOf(path);
  if (index === -1) return null;
  const next = tabs.filter((entry) => entry !== path);
  write(next);
  return next[Math.min(index, next.length - 1)] ?? null;
}

export function useWorkspaceTabs(): string[] {
  return useSyncExternalStore(subscribe, readStored, () => EMPTY);
}
