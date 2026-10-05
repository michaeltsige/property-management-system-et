'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (`public/sw.js`) after the window loads.
 *
 * Failure is silent on purpose: an unsupported browser, a private window or a
 * hardened environment (including the workspace preview iframe, which has no
 * network) simply gets the ordinary web app. See ADR-0023.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

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
