import '@testing-library/jest-dom/vitest';

import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom implements neither layout nor events; these are the three APIs Radix
 * primitives and ECharts touch on mount. Anything the components actually assert
 * on is real DOM behaviour, so a stub here cannot hide a bug.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

// Server-side modules (the API proxy, cookies) are tested in the node
// environment, where there is no window to patch.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
}

if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
}

// The app fetches translation overrides and data on mount; tests that do not
// care about the network get a rejected fetch, which the code paths already
// treat as "offline, use the shipped catalogs".
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
  vi.restoreAllMocks();
});
