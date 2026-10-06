import type { NextConfig } from 'next';

/**
 * The browser talks to this app, and this app talks to the API.
 *
 * `/api/v1/*` and `/api/session/*` are **route handlers**, not rewrites: the
 * browser's request is rebuilt server-side with an `Authorization` header taken
 * from an `HttpOnly` cookie, and the browser's own `Origin`/`Cookie` headers are
 * dropped before it reaches the API. See `src/lib/server/api-proxy.ts` and
 * ADR-0026, including why a rewrite was not enough.
 *
 * The API's own address is never exposed to the browser: `API_PROXY_TARGET`
 * defaults to `http://127.0.0.1:4000` and is read by the route handlers, not by
 * anything that ships to the client.
 */

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,

  experimental: {
    /**
     * The webpack dev server is the largest process in the stack (~600 MB without
     * this). Next's own memory optimisations trade a little compile time for a
     * smaller footprint, which is what makes `pnpm dev:all` viable on a 2 GB Cloud
     * Shell VM. Applied in development only: production builds are untouched.
     */
    ...(process.env.NODE_ENV === 'production' ? {} : { webpackMemoryOptimizations: true }),
  },

  /**
   * Dev-only: Next blocks cross-origin requests to `/_next/*` assets and HMR
   * endpoints unless the origin is allowed. Cloud Shell's Web Preview serves the
   * app from `https://<port>-<vm>.cloudshell.dev`, and the sandbox preview uses a
   * similar host, so both are allowed here. `localhost` and `127.0.0.1` are the
   * same machine but not the same origin to Next, and a developer who types the
   * IP instead of the name would otherwise get a page that never hydrates (the
   * HTML loads, the JavaScript chunks are refused, no error is shown to them).
   * Production traffic never reaches `next dev`, so nothing is relaxed in a real
   * deployment.
   */
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '*.cloudshell.dev',
    '**.cloudshell.dev',
    '*.e2b.app',
    '**.e2b.app',
  ],

  /**
   * A stale service worker can pin users to an obsolete build forever, so the
   * worker itself and its manifest are never cached by anything in between.
   */
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
      },
    ];
  },
};

export default nextConfig;
