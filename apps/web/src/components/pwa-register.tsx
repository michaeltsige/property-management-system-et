'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (`public/sw.js`) after the window loads.
 *
 * Production only. In development Next serves unhashed chunk URLs, which the
 * worker's cache-first rule would keep serving forever after a code change —
 * the browser then loads new HTML against stale JavaScript and hangs while the
 * terminal looks healthy. Dev mode also precaches `/offline`, forcing a full
 * on-demand compile of the app shell on every page load. See ADR-0023.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      // Remove any worker a previous visit registered, so it cannot keep
      // intercepting dev requests with stale chunks.
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister().catch(() => undefined);
      });
      return;
    }

    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
