import type { NextConfig } from 'next';

/**
 * The browser talks to the API through this app, never directly.
 *
 * `/api/*` is rewritten **server-side** to the Express API (default
 * `http://127.0.0.1:4000`, override with `API_PROXY_TARGET`), so the client only
 * ever uses relative URLs. That keeps one origin in every environment — local,
 * Cloud Shell / any port-forwarding proxy, and production behind a load balancer
 * — and means the API port never has to be exposed to a browser.
 */
const apiTarget = (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');

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
   * similar host, so both are allowed here. Production traffic never reaches
   * `next dev`, so nothing is relaxed in a real deployment.
   */
  allowedDevOrigins: ['*.cloudshell.dev', '**.cloudshell.dev', '*.e2b.app', '**.e2b.app'],

  async rewrites() {
    return [
      // Everything under /api reaches the Express API, which serves the versioned
      // REST surface at /api/v1/* (health checks included).
      { source: '/api/:path*', destination: `${apiTarget}/api/:path*` },
    ];
  },

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
