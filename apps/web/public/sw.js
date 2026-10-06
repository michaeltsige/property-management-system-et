/*
 * Service worker — deliberately small and deliberately honest (ADR-0023).
 *
 * What it does:
 *   - precaches the offline page, the manifest and the icons;
 *   - serves immutable build assets (`/_next/static/*`) and icons cache-first;
 *   - serves page navigations network-first, falling back to the offline page;
 *   - never touches `/api/*`: money data is live or it is absent, never stale.
 *
 * What it does not do: cache pages or API responses in the background, replay
 * failed writes, or pretend the app works offline. Recording a payment is a
 * network operation; when there is no network, the user is told so.
 *
 * Bump VERSION whenever the caching rules change; the activate step deletes
 * every cache from other versions.
 */
const VERSION = 'pms-shell-v2';
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(PRECACHE);

      // The offline page is a Next.js route: its HTML points at hashed chunks.
      // Caching the document alone would load markup whose script never runs, so
      // read the document and cache every build asset it references.
      const response = await fetch(OFFLINE_URL, { cache: 'reload' });
      await cache.put(OFFLINE_URL, response.clone());
      const html = await response.text();
      const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((match) => match[1]);
      if (assets.length > 0) await cache.addAll([...new Set(assets)]);

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Financial data is never served from a cache.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(VERSION);
          const offline = await cache.match(OFFLINE_URL);
          return offline ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});
