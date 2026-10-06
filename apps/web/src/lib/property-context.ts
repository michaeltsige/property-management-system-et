'use client';

import { useSyncExternalStore } from 'react';

/**
 * The "current property" filter shared by the header switcher and the screens.
 *
 * It is a display preference only: every screen still asks the API for the whole
 * organization and filters locally, so selecting a property can never widen or
 * narrow what the role is allowed to see. Storage survives reloads; a custom
 * event keeps every mounted component in sync without a provider.
 */
const STORAGE_KEY = 'pms.property-context.v1';
const CHANGE_EVENT = 'pms-property-context';

function readStored(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function getPropertyContext(): string | null {
  return readStored();
}

export function setPropertyContext(propertyId: string | null): void {
  try {
    if (propertyId) window.localStorage.setItem(STORAGE_KEY, propertyId);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private windows can deny localStorage; the in-memory snapshot still updates.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function usePropertyContext(): [string | null, (propertyId: string | null) => void] {
  const value = useSyncExternalStore(subscribe, readStored, () => null);
  return [value, setPropertyContext];
}
