// @vitest-environment node
/**
 * Session cookies: what the browser is asked to store, and the one decision that
 * breaks everything if it is guessed wrong — whether to mark them `Secure`.
 */

import { describe, expect, it } from 'vitest';

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearedSessionCookies,
  forwardedProtocol,
  isSecureRequest,
  parseCookieHeader,
  readSessionTokens,
  serializeCookie,
  sessionCookies,
} from '@/lib/server/cookies';

const TOKENS = { accessToken: 'access-token-value', refreshToken: 'refresh-token-value' };

function request(headers: Record<string, string> = {}, url = 'http://127.0.0.1:3000/api/session/login') {
  return new Request(url, { headers });
}

describe('parseCookieHeader', () => {
  it('parses a normal header', () => {
    expect(parseCookieHeader('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('survives the shapes a browser actually sends', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
    expect(parseCookieHeader('flag; a=1')).toEqual({ a: '1' });
    expect(parseCookieHeader('token=a%2Eb%2Ec')).toEqual({ token: 'a.b.c' });
    // A value that is not valid percent-encoding must not throw mid-request.
    expect(parseCookieHeader('token=%E0%A4%A')).toEqual({ token: '%E0%A4%A' });
  });

  it('reads only the two session cookies', () => {
    const tokens = readSessionTokens(
      request({ cookie: `${ACCESS_COOKIE}=at; ${REFRESH_COOKIE}=rt; theme=dark` }),
    );
    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt' });
  });
});

describe('serializeCookie', () => {
  it('is HttpOnly, SameSite=Lax and path-scoped by default', () => {
    const cookie = serializeCookie('pms_at', 'value', { maxAge: 900, secure: false });
    expect(cookie).toBe('pms_at=value; Path=/; Max-Age=900; SameSite=Lax; HttpOnly');
  });

  it('adds Secure only when asked', () => {
    expect(serializeCookie('pms_at', 'v', { maxAge: 1, secure: true })).toContain('Secure');
    expect(serializeCookie('pms_at', 'v', { maxAge: 1, secure: false })).not.toContain('Secure');
  });

  it('encodes values that would otherwise break the header', () => {
    const cookie = serializeCookie('pms_at', 'a;b c', { maxAge: 900, secure: false });
    expect(cookie.startsWith('pms_at=a%3Bb%20c;')).toBe(true);
  });
});

describe('the Secure flag', () => {
  it('is on when the tunnel says the browser is on https', () => {
    expect(isSecureRequest(request({ 'x-forwarded-proto': 'https' }), {})).toBe(true);
    expect(isSecureRequest(request({ 'x-forwarded-proto': 'https, http' }), {})).toBe(true);
  });

  it('is off for plain http, so local development can sign in', () => {
    // A Secure cookie on an http origin is silently dropped by the browser, which
    // looks exactly like "login did nothing".
    expect(isSecureRequest(request({}), {})).toBe(false);
    expect(isSecureRequest(request({ 'x-forwarded-proto': 'http' }), {})).toBe(false);
  });

  it('falls back to the request URL when the proxy sends no proto header', () => {
    expect(isSecureRequest(request({}, 'https://pms.example.test/api/session/login'), {})).toBe(true);
  });

  it('can be overridden for a deployment whose proxy says nothing useful', () => {
    expect(isSecureRequest(request({}), { COOKIE_SECURE: 'true' })).toBe(true);
    expect(isSecureRequest(request({ 'x-forwarded-proto': 'https' }), { COOKIE_SECURE: 'false' })).toBe(
      false,
    );
  });

  it('takes the first hop of a forwarded protocol list', () => {
    expect(forwardedProtocol(request({ 'x-forwarded-proto': 'HTTPS,http' }))).toBe('https');
  });
});

describe('session cookie values', () => {
  it('marks both cookies HttpOnly with a matching Max-Age', () => {
    const [access, refresh] = sessionCookies(TOKENS, true);
    expect(access).toContain('Max-Age=900');
    expect(refresh).toContain('Max-Age=2592000');
    for (const cookie of [access, refresh]) expect(cookie).toContain('HttpOnly');
  });

  it('honours lifetime overrides', () => {
    const [access] = sessionCookies(TOKENS, false, { SESSION_ACCESS_MAX_AGE_SECONDS: '60' });
    expect(access).toContain('Max-Age=60');
  });

  it('clears both cookies by expiring them', () => {
    const cleared = clearedSessionCookies(false);
    expect(cleared).toHaveLength(2);
    for (const cookie of cleared) expect(cookie).toContain('Max-Age=0');
  });
});
