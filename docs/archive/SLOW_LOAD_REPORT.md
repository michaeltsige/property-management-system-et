# Slow first load / hanging browser in Cloud Shell dev mode

## Diagnosis

The supplied terminal shows a healthy stack (API health 200 in 3 ms, pages
compiled) while the browser never finishes loading. The service worker
(pwa-register.tsx + public/sw.js) explains it:

1. The worker precaches `/offline` on install. In dev mode that URL triggers a
   full on-demand compile of the app shell (~2,100 modules, ~8.5 s on Cloud Shell)
   on every page load.
2. Dev chunks are served at unhashed URLs. The worker caches them cache-first by
   URL, and the version only changes when sw.js itself changes. After pulling new
   code and restarting, the registered worker keeps serving stale JavaScript
   against the newly compiled HTML: the page cannot hydrate and appears to hang,
   while the server logs show normal 200 responses.

This is not a database, migration or package-build problem; rebuilding
`./packages/*` does not touch the browser's worker cache. The terminal alone
cannot show it because the stale content lives in the browser.

## Fix

PwaRegister now registers only in production. In development it unregisters any
existing worker so a stale one cannot keep intercepting requests. sw.js itself is
unchanged: content-hashed production assets, versioned precache, and
network-first navigations remain correct there. No new dependency, migration or
storage change; PWA/offline behavior is preserved for production builds.

## Verification

New component tests: dev mode unregisters and never registers; production mode
registers after load. Web suite, typecheck, lint and formatting pass locally; CI
verifies the same plus the critical audit gate. This is not real Cloud Shell
browser evidence — see the checklist.

## Manual checklist (Cloud Shell)

1. Stop dev:all (Ctrl+C), update, install, start again.
2. Open DevTools → Application → Service Workers; unregister any worker for the
   preview origin (or hard-refresh with Ctrl+Shift+R until none is listed).
3. Reload the preview. First visits still compile on demand (Dashboard imports
   the chart library and can take ~10–20 s on the 2 GB tier); subsequent
   navigations reuse the dev cache.
4. Expect no worker to appear in dev; offline/PWA behavior belongs to the
   production build (`next build && next start`), not `pnpm dev:all`.
