/**
 * Session endpoints: `login`, `register`, `refresh`, `logout`, `me`.
 *
 * These are the only places a token is allowed to touch the browser — and even
 * here it only reaches it as a `Set-Cookie` header. The JSON responses carry the
 * user, the organization and the role, never a credential (ADR-0026).
 */

import { handleSession } from '@/lib/server/api-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request: Request) {
  return handleSession(request);
}

export function POST(request: Request) {
  return handleSession(request);
}
