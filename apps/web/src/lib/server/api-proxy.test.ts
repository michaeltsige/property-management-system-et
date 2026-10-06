// @vitest-environment node
/**
 * The proxy is a security boundary, so its tests are about what crosses it:
 * which header is added, which are dropped, when a request is refused, and what
 * a 401 turns into.
 *
 * `fetch` is mocked, so these run in milliseconds and make claims only about this
 * module's behaviour. Whether the whole thing works in a browser behind a proxy
 * is a different question, answered by the acceptance run (see ADR-0026).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleApiProxy,
  handleSession,
  proxyDeps,
  refreshTokens,
  resetRefreshCache,
} from '@/lib/server/api-proxy';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/server/cookies';

const BASE = 'http://127.0.0.1:4000';

// Refreshes are deduped by token value in module state, so tests must not inherit
// each other's rotations.
beforeEach(() => {
  resetRefreshCache();
});

function makeDeps(fetchImpl: typeof fetch, env: Record<string, string | undefined> = {}) {
  return proxyDeps({
    fetchImpl,
    apiTarget: BASE,
    env: { API_PROXY_TARGET: BASE, NODE_ENV: 'production', ...env },
  });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://pms.example.test${path}`, init);
}

const COOKIE = `${ACCESS_COOKIE}=access-abc; ${REFRESH_COOKIE}=refresh-xyz`;

function cookieValue(response: Response, name: string): string | undefined {
  const header = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  if (!header) return undefined;
  return header.slice(name.length + 1).split(';')[0];
}

describe('token injection', () => {
  it('attaches the Bearer token from the session cookie', async () => {
    const fetchImpl = vi.fn(async () => json({ leases: [] }));
    const response = await handleApiProxy(
      request('/api/v1/leases', { headers: { cookie: COOKIE } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/leases`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer access-abc');
  });

  it('sends no Authorization header when there is no session', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    await handleApiProxy(
      request('/api/v1/health', { headers: { 'x-requested-with': 'XMLHttpRequest' } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('never returns a token in the response body', async () => {
    const fetchImpl = vi.fn(async () => json({ leases: [], accessToken: 'leaked', refreshToken: 'leaked' }));
    const response = await handleApiProxy(
      request('/api/v1/leases', { headers: { cookie: COOKIE } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    const text = await response.text();
    // The proxy is a pipe for data; tokens are not part of the data contract.
    expect(text).toContain('accessToken');
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe('headers the API must never see', () => {
  it('drops the browser Origin and Cookie headers', async () => {
    const fetchImpl = vi.fn(async () => json({ leases: [] }));
    await handleApiProxy(
      request('/api/v1/leases', {
        headers: {
          cookie: COOKIE,
          origin: 'https://pms.example.test',
          host: 'pms.example.test',
          referer: 'https://pms.example.test/leases',
          'x-forwarded-for': '203.0.113.7',
        },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    const sent = init.headers as Record<string, string>;
    expect(sent.cookie).toBeUndefined();
    expect(sent.origin).toBeUndefined();
    expect(sent.referer).toBeUndefined();
    expect(sent.host).toBeUndefined();
    expect(sent['x-forwarded-for']).toBeUndefined();
  });

  it('forwards only the headers on the allowlist', async () => {
    const fetchImpl = vi.fn(async () => json({ leases: [] }));
    await handleApiProxy(
      request('/api/v1/leases', {
        headers: {
          cookie: COOKIE,
          accept: 'application/json',
          'accept-language': 'am',
          'content-type': 'application/json',
          'x-custom-sneaky': 'nope',
        },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    const sent = init.headers as Record<string, string>;
    expect(sent.accept).toBe('application/json');
    expect(sent['accept-language']).toBe('am');
    expect(sent['x-custom-sneaky']).toBeUndefined();
  });

  it('does not leak upstream headers that would corrupt the rewritten body', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ leases: [] }, 200, { 'content-encoding': 'gzip', 'content-length': '999', 'set-cookie': 'x=1' }),
    );
    const response = await handleApiProxy(
      request('/api/v1/leases', { headers: { cookie: COOKIE } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe('CSRF protection', () => {
  it('rejects a state-changing request without the custom header', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const response = await handleApiProxy(
      request('/api/v1/leases', { method: 'POST', body: '{}', headers: { cookie: COOKIE } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('CSRF_HEADER');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a state-changing request from another origin', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const response = await handleApiProxy(
      request('/api/v1/leases', {
        method: 'POST',
        body: '{}',
        headers: {
          cookie: COOKIE,
          'x-requested-with': 'XMLHttpRequest',
          origin: 'https://evil.example',
          host: 'pms.example.test',
        },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('CSRF_ORIGIN');
    // The message has to be enough to diagnose a proxy that rewrites hosts.
    expect(body.error.message).toContain('https://evil.example');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a state-changing request from its own origin', async () => {
    const fetchImpl = vi.fn(async () => json({ lease: { id: 'lease-1' } }, 201));
    const response = await handleApiProxy(
      request('/api/v1/leases', {
        method: 'POST',
        body: JSON.stringify({ unitId: 'unit-1' }),
        headers: {
          cookie: COOKIE,
          'x-requested-with': 'XMLHttpRequest',
          origin: 'https://pms.example.test',
          host: 'pms.example.test',
          'content-type': 'application/json',
        },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts an origin that only the forwarding proxy knows (Cloud Shell)', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const response = await handleApiProxy(
      request('/api/v1/leases', {
        method: 'POST',
        body: '{}',
        headers: {
          cookie: COOKIE,
          'x-requested-with': 'XMLHttpRequest',
          // The browser is on https://3000-vm.cloudshell.dev; the Node process
          // sees a plain-http request to 0.0.0.0:3000.
          origin: 'https://3000-vm.cloudshell.dev',
          host: '0.0.0.0:3000',
          'x-forwarded-host': '3000-vm.cloudshell.dev',
          'x-forwarded-proto': 'https',
          'content-type': 'application/json',
        },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
  });

  it('accepts its own host when the proxy forwards it on a different port', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const response = await handleApiProxy(
      request('/api/v1/leases', {
        method: 'POST',
        body: '{}',
        headers: {
          cookie: COOKIE,
          'x-requested-with': 'XMLHttpRequest',
          // TLS terminates on :3443 and forwards to 0.0.0.0:3000; the browser's
          // host is the same, the ports are not. Same host = same site.
          origin: 'https://localhost:3443',
          host: '0.0.0.0:3000',
          'x-forwarded-host': 'localhost',
          'x-forwarded-proto': 'https',
          'content-type': 'application/json',
        },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
  });

  it('still rejects a lookalike host that only shares a suffix', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const response = await handleApiProxy(
      request('/api/v1/leases', {
        method: 'POST',
        body: '{}',
        headers: {
          cookie: COOKIE,
          'x-requested-with': 'XMLHttpRequest',
          origin: 'https://3000-vm.cloudshell.dev.evil.example',
          host: '0.0.0.0:3000',
          'x-forwarded-host': '3000-vm.cloudshell.dev',
          'content-type': 'application/json',
        },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets GET through without the header, because it changes nothing', async () => {
    const fetchImpl = vi.fn(async () => json({ properties: [] }));
    const response = await handleApiProxy(
      request('/api/v1/properties', { headers: { cookie: COOKIE } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
  });

  it('keeps refusing a foreign origin in production', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const response = await handleApiProxy(
      request('/api/v1/leases', {
        method: 'POST',
        body: '{}',
        headers: {
          'x-requested-with': 'XMLHttpRequest',
          origin: 'https://3000-vm.cloudshell.dev',
          host: '0.0.0.0:3000',
        },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch, { NODE_ENV: 'production' }),
    );

    expect(response.status).toBe(403);
  });
});

describe('refresh flow', () => {
  it('refreshes once on 401 and replays the request with the new token', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string>).authorization;
      if (url.endsWith('/api/v1/auth/refresh')) {
        return json({ tokens: { accessToken: 'access-new', refreshToken: 'refresh-new' } });
      }
      if (authorization === 'Bearer access-old') return json({ error: { code: 'EXPIRED' } }, 401);
      return json({ leases: [{ id: 'lease-1' }] });
    });

    const response = await handleApiProxy(
      request('/api/v1/leases', {
        headers: { cookie: `${ACCESS_COOKIE}=access-old; ${REFRESH_COOKIE}=refresh-old` },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ leases: [{ id: 'lease-1' }] });

    // refresh, then the replayed call
    const urls = fetchImpl.mock.calls.map((call) => call[0] as string);
    expect(urls).toEqual([`${BASE}/api/v1/leases`, `${BASE}/api/v1/auth/refresh`, `${BASE}/api/v1/leases`]);

    // The browser must end up holding the rotated pair.
    expect(cookieValue(response, ACCESS_COOKIE)).toBe('access-new');
    expect(cookieValue(response, REFRESH_COOKIE)).toBe('refresh-new');
    const setCookie = response.headers.getSetCookie().join(' ');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('replays the request body after refreshing', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/api/v1/auth/refresh')) {
        return json({ tokens: { accessToken: 'access-new', refreshToken: 'refresh-new' } });
      }
      if ((init.headers as Record<string, string>).authorization === 'Bearer access-old') {
        return json({ error: { code: 'EXPIRED' } }, 401);
      }
      return json({ payment: { id: 'payment-1' } }, 201);
    });

    await handleApiProxy(
      request('/api/v1/payments', {
        method: 'POST',
        body: JSON.stringify({ amountMinor: 1_500_00 }),
        headers: {
          cookie: `${ACCESS_COOKIE}=access-old; ${REFRESH_COOKIE}=refresh-old`,
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
        },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    const replayed = fetchImpl.mock.calls[2]! as unknown as [string, RequestInit];
    // A body stream can only be read once, so the proxy buffers it up front.
    expect(replayed[1].body).toBeDefined();
    expect(new TextDecoder().decode(replayed[1].body as ArrayBuffer)).toBe('{"amountMinor":150000}');
  });

  it('clears the session when the refresh token is refused', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/auth/refresh')) return json({ error: { code: 'UNAUTHENTICATED' } }, 401);
      return json({ error: { code: 'UNAUTHENTICATED' } }, 401);
    });

    const response = await handleApiProxy(
      request('/api/v1/leases', { headers: { cookie: COOKIE } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(401);
    const setCookie = response.headers.getSetCookie().join(' ');
    expect(setCookie).toContain(`${ACCESS_COOKIE}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('does not try to refresh without a refresh cookie', async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: 'UNAUTHENTICATED' } }, 401));
    await handleApiProxy(
      request('/api/v1/leases', { headers: { cookie: `${ACCESS_COOKIE}=access-old` } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns 502, not a crash, when the API is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const response = await handleApiProxy(
      request('/api/v1/leases', { headers: { cookie: COOKIE } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('token-minting endpoints', () => {
  it('is not reachable through the browser proxy', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const response = await handleApiProxy(
      request('/api/v1/auth/login', {
        method: 'POST',
        body: '{}',
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_PROXIED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('also blocks the tenant OTP verification endpoint', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const response = await handleApiProxy(
      request('/api/v1/portal/verify', {
        method: 'POST',
        body: '{}',
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_PROXIED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('tenant portal session endpoints', () => {
  it('request-code passes the uniform answer through without cookies', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`${BASE}/api/v1/portal/request-code`);
      return json({ ok: true });
    });
    const response = await handleSession(
      request('/api/session/portal-request', {
        method: 'POST',
        body: JSON.stringify({ phone: '0911234567' }),
        headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('verify sets HttpOnly cookies and returns identity only', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`${BASE}/api/v1/portal/verify`);
      return json({
        tokens: { accessToken: 'access-2', refreshToken: 'refresh-2' },
        role: 'tenant',
        user: { id: 'user-2', email: 'portal-t1@tenants.invalid', fullName: 'Tenant One' },
        organization: { id: 'org-1', name: 'Bole Demo', slug: 'bole-demo' },
        memberships: [],
        tenant: { id: 'tenant-1', fullName: 'Tenant One', organizationId: 'org-1' },
      });
    });

    const response = await handleSession(
      request('/api/session/portal-verify', {
        method: 'POST',
        body: JSON.stringify({ phone: '0911234567', code: '123456' }),
        headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.role).toBe('tenant');
    expect(body.tenant.id).toBe('tenant-1');
    expect(JSON.stringify(body)).not.toContain('access-2');
    expect(JSON.stringify(body)).not.toContain('refresh-2');
    expect(cookieValue(response, ACCESS_COOKIE)).toBe('access-2');
    expect(cookieValue(response, REFRESH_COOKIE)).toBe('refresh-2');
  });

  it('verify passes a wrong-code error through without setting cookies', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { code: 'UNAUTHENTICATED', message: 'Email or code is incorrect' } }, 401),
    );
    const response = await handleSession(
      request('/api/session/portal-verify', {
        method: 'POST',
        body: JSON.stringify({ phone: '0911234567', code: '000000' }),
        headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe('Email or code is incorrect');
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe('session endpoints', () => {
  it('login sets HttpOnly cookies and returns identity only', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`${BASE}/api/v1/auth/login`);
      return json({
        tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
        user: { id: 'user-1', email: 'owner@demo.test', fullName: 'Demo Owner' },
        organization: { id: 'org-1', name: 'Bole Demo', slug: 'bole-demo' },
        role: 'owner_admin',
        memberships: [{ organizationId: 'org-1', role: 'owner_admin' }],
      });
    });

    const response = await handleSession(
      request('/api/session/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'owner@demo.test', password: 'DemoPass123' }),
        headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.email).toBe('owner@demo.test');
    expect(body.role).toBe('owner_admin');
    expect(JSON.stringify(body)).not.toContain('access-1');
    expect(JSON.stringify(body)).not.toContain('refresh-1');

    expect(cookieValue(response, ACCESS_COOKIE)).toBe('access-1');
    expect(cookieValue(response, REFRESH_COOKIE)).toBe('refresh-1');
  });

  it('login passes the API error through untouched', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { code: 'UNAUTHENTICATED', message: 'Email or password is incorrect' } }, 401),
    );
    const response = await handleSession(
      request('/api/session/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.test', password: 'wrong' }),
        headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe('Email or password is incorrect');
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('me returns 401 when there is no session', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const response = await handleSession(
      request('/api/session/me'),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('me forwards the cookie as a Bearer token', async () => {
    const fetchImpl = vi.fn(async () => json({ user: { userId: 'user-1', role: 'manager' } }));
    const response = await handleSession(
      request('/api/session/me', { headers: { cookie: COOKIE } }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer access-abc');
  });

  it('logout clears cookies even when the API call fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const response = await handleSession(
      request('/api/session/logout', {
        method: 'POST',
        body: '{}',
        headers: { cookie: COOKIE, 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(204);
    const setCookie = response.headers.getSetCookie().join(' ');
    expect(setCookie).toContain(`${ACCESS_COOKIE}=;`);
    expect(setCookie).toContain(`${REFRESH_COOKIE}=;`);
  });

  it('refresh rotates the cookies when the refresh token is still valid', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`${BASE}/api/v1/auth/refresh`);
      return json({ tokens: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
    });

    const response = await handleSession(
      request('/api/session/refresh', {
        method: 'POST',
        body: '{}',
        headers: { cookie: COOKIE, 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
    expect(cookieValue(response, REFRESH_COOKIE)).toBe('refresh-2');
  });

  it('refresh clears the cookies when the token is refused', async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: 'UNAUTHENTICATED' } }, 401));
    const response = await handleSession(
      request('/api/session/refresh', {
        method: 'POST',
        body: '{}',
        headers: { cookie: COOKIE, 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().join(' ')).toContain('Max-Age=0');
  });

  it('rejects an unknown session action', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const response = await handleSession(
      request('/api/session/steal', {
        method: 'POST',
        body: '{}',
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(404);
  });

  it('applies CSRF protection to session writes too', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const response = await handleSession(
      request('/api/session/login', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
      makeDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('refreshTokens', () => {
  it('returns null for a malformed upstream body', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    const tokens = await refreshTokens(makeDeps(fetchImpl as unknown as typeof fetch), 'refresh-old');
    expect(tokens).toBeNull();
  });

  it('refreshes once when several requests present the same token at once', async () => {
    let refreshes = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/v1/auth/refresh')) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return json({ tokens: { accessToken: 'access-new', refreshToken: 'refresh-new' } });
      }
      return json({ leases: [] });
    });
    const deps = makeDeps(fetchImpl as unknown as typeof fetch);

    // A page load: four screens fetch at the same time with an expired access token.
    const tokens = await Promise.all([
      refreshTokens(deps, 'refresh-old'),
      refreshTokens(deps, 'refresh-old'),
      refreshTokens(deps, 'refresh-old'),
      refreshTokens(deps, 'refresh-old'),
    ]);

    // A second rotation would present a revoked token, which the API answers by
    // revoking every session for the user.
    expect(refreshes).toBe(1);
    for (const entry of tokens) expect(entry?.accessToken).toBe('access-new');
  });

  it('replays a rotation for a request that still holds the rotated token', async () => {
    let refreshes = 0;
    const fetchImpl = vi.fn(async () =>
      refreshes++ === 0
        ? json({ tokens: { accessToken: 'access-new', refreshToken: 'refresh-new' } })
        : json({ error: { code: 'UNAUTHENTICATED' } }, 401),
    );
    const deps = makeDeps(fetchImpl as unknown as typeof fetch);

    expect((await refreshTokens(deps, 'refresh-old'))?.accessToken).toBe('access-new');
    // Arrives with the cookie the browser had a moment ago.
    expect((await refreshTokens(deps, 'refresh-old'))?.refreshToken).toBe('refresh-new');
    expect(refreshes).toBe(1);
  });

  it('does not replay a refusal, so a signed-out user is not resurrected', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return json({ error: { code: 'UNAUTHENTICATED' } }, 401);
    });
    const deps = makeDeps(fetchImpl as unknown as typeof fetch);

    expect(await refreshTokens(deps, 'refresh-dead')).toBeNull();
    expect(await refreshTokens(deps, 'refresh-dead')).toBeNull();
    expect(calls).toBe(2);
  });
});
