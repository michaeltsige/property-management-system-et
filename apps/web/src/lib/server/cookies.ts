/**
 * Session cookies for the browser-facing proxy.
 *
 * The browser holds an opaque session in two `HttpOnly` cookies; it never sees a
 * token and never sends an `Authorization` header (ADR-0026). The Express API is
 * unchanged and still authenticates Bearer tokens — the web server is simply the
 * only client that has them.
 *
 * `Secure` is decided per request, never hardcoded: Cloud Shell Web Preview and
 * every other tunnel terminate TLS in front of the VM, so the Node process sees
 * plain `http` while the browser sees `https`. Marking the cookie `Secure` on a
 * plain-http origin would make the browser drop it and sign the user straight back
 * out; withholding it on an https origin would send it in the clear. The rule is
 * therefore: trust `x-forwarded-proto`, allow an explicit override, and only mark
 * `Secure` when the browser's own connection is https (or `COOKIE_SECURE=true`).
 */

export const ACCESS_COOKIE = 'pms_at';
export const REFRESH_COOKIE = 'pms_rt';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface CookieAttributes {
  maxAge: number;
  secure: boolean;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

/**
 * Cookie lifetimes are independent of the API's token lifetimes: the API is the
 * authority on validity and answers 401 when a token has aged out, which the
 * proxy turns into a refresh. These only decide when the browser stops carrying
 * them. The refresh default matches the API's `JWT_REFRESH_TTL_SECONDS` (30 days).
 */
const ACCESS_MAX_AGE_DEFAULT = 900;
const REFRESH_MAX_AGE_DEFAULT = 2_592_000;

export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      // A malformed value is not worth throwing over: treat it as the raw text.
      cookies[name] = raw;
    }
  }
  return cookies;
}

export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${attributes.path ?? '/'}`,
    `Max-Age=${Math.max(0, Math.floor(attributes.maxAge))}`,
    `SameSite=${attributes.sameSite ?? 'Lax'}`,
  ];
  if (attributes.httpOnly ?? true) parts.push('HttpOnly');
  if (attributes.secure) parts.push('Secure');
  return parts.join('; ');
}

/** First hop of `x-forwarded-proto`, which may be a comma-separated list. */
export function forwardedProtocol(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]!.trim().toLowerCase();
  try {
    return new URL(request.url).protocol.replace(':', '').toLowerCase();
  } catch {
    return 'http';
  }
}

export function isSecureRequest(request: Request, env: EnvLike = process.env): boolean {
  const override = env.COOKIE_SECURE?.trim().toLowerCase();
  if (override === 'true') return true;
  if (override === 'false') return false;
  return forwardedProtocol(request) === 'https';
}

function maxAgeFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function accessMaxAge(env: EnvLike = process.env): number {
  return maxAgeFromEnv(env.SESSION_ACCESS_MAX_AGE_SECONDS, ACCESS_MAX_AGE_DEFAULT);
}

export function refreshMaxAge(env: EnvLike = process.env): number {
  return maxAgeFromEnv(env.SESSION_REFRESH_MAX_AGE_SECONDS, REFRESH_MAX_AGE_DEFAULT);
}

export type EnvLike = Record<string, string | undefined>;

/** Two `Set-Cookie` values: the session, as the browser should now hold it. */
export function sessionCookies(tokens: SessionTokens, secure: boolean, env: EnvLike = process.env): string[] {
  return [
    serializeCookie(ACCESS_COOKIE, tokens.accessToken, { maxAge: accessMaxAge(env), secure }),
    serializeCookie(REFRESH_COOKIE, tokens.refreshToken, { maxAge: refreshMaxAge(env), secure }),
  ];
}

/**
 * Expire both cookies. Used on logout and whenever the refresh token is refused,
 * so a dead session cannot leave the browser replaying an unusable cookie.
 */
export function clearedSessionCookies(secure: boolean): string[] {
  return [
    serializeCookie(ACCESS_COOKIE, '', { maxAge: 0, secure }),
    serializeCookie(REFRESH_COOKIE, '', { maxAge: 0, secure }),
  ];
}

export function readSessionTokens(request: Request): Partial<SessionTokens> {
  const cookies = parseCookieHeader(request.headers.get('cookie'));
  return {
    accessToken: cookies[ACCESS_COOKIE] || undefined,
    refreshToken: cookies[REFRESH_COOKIE] || undefined,
  };
}
