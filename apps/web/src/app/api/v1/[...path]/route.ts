/**
 * Same-origin API proxy — the only path from the browser to the Express API.
 *
 * A route handler rather than a `next.config` rewrite, because a rewrite can only
 * forward what the browser sent. This has to *change* the request: drop the
 * browser's `Origin` and `Cookie`, attach the `Authorization` header from the
 * `HttpOnly` session cookie, and retry once behind a refresh when the access token
 * has expired. See `lib/server/api-proxy.ts` and ADR-0026.
 */

import { handleApiProxy } from '@/lib/server/api-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request: Request) {
  return handleApiProxy(request);
}

export function POST(request: Request) {
  return handleApiProxy(request);
}

export function PATCH(request: Request) {
  return handleApiProxy(request);
}

export function PUT(request: Request) {
  return handleApiProxy(request);
}

export function DELETE(request: Request) {
  return handleApiProxy(request);
}
