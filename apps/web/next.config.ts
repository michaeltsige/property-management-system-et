import type { NextConfig } from 'next';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000';

/**
 * The browser talks to the API through this app, never directly.
 *
 * `/api/v1/*` is rewritten server-side to the Express API, so the client uses
 * relative URLs only. That keeps the same-origin rule intact in every
 * environment (local, sandbox preview, production behind a load balancer) and
 * avoids baking a hostname into the bundle.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiTarget}/api/:path*` }];
  },
};

export default nextConfig;
