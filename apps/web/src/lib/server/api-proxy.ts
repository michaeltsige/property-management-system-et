/**
 * The browser-facing API proxy.
 *
 * Everything the browser calls under `/api/v1/*` lands here. This module is the
 * only place in the web app that holds a token: it reads the `HttpOnly` session
 * cookies, attaches `Authorization: Bearer …` **server-side**, and forwards the
 * request to the Express API. The browser's own `Origin` and `Cookie` headers are
 * never forwarded — the API is a different origin and has no business seeing
 * either — and the access token is never echoed back in a response body.
 *
 * Why this shape (ADR-0026): Cloud Shell Web Preview (and every tunnel like it)
 * sits between the browser and the VM. A request the proxy decides it does not
 * like — an `Authorization` header on a request it cannot vouch for — fails at
 * the edge, in the browser, as `TypeError: Failed to fetch`, and never reaches
 * the server. Removing the header from every browser request removes the whole
 * class of failure, and has a second benefit: a token in a cookie cannot be read
 * by injected script.
 *
 * The Express API is unchanged. It still authenticates Bearer tokens, which keeps
 * curl, scripts and the future mobile app working exactly as before.
 */

import {
  type EnvLike,
  type SessionTokens,
  clearedSessionCookies,
  forwardedProtocol,
  isSecureRequest,
  readSessionTokens,
  sessionCookies,
} from './cookies';

export interface ProxyDeps {
  fetchImpl: typeof fetch;
  apiTarget: string;
  env: EnvLike;
}

export function proxyDeps(overrides: Partial<ProxyDeps> = {}): ProxyDeps {
  const env = overrides.env ?? (process.env as EnvLike);
  return {
    env,
    apiTarget: (overrides.apiTarget ?? env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000').replace(/\/+$/, ''),
    fetchImpl: overrides.fetchImpl ?? fetch,
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Request headers worth passing on. Anything absent here is dropped, by design. */
const FORWARD_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'accept-language',
  'if-none-match',
  'if-modified-since',
  'range',
  'x-request-id',
];

/** Response headers worth passing back. `set-cookie` is ours, not the API's. */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'retry-after', 'x-request-id'];

/** Endpoints that mint tokens are not reachable from the browser (see ADR-0026). */
const TOKEN_MINTING_PATHS = new Set(['/auth/login', '/auth/register', '/auth/refresh']);

const UPSTREAM_TIMEOUT_MS = 30_000;

export function jsonProblem(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function jsonResponse(body: unknown, status: number, setCookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(status: number, setCookies: string[] = []): Response {
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return new Response(null, { status, headers });
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * The host of an origin, or `''` when it is not an http(s) origin.
 *
 * Origins are compared by host, not by `host:port`: a proxy in front of the app
 * is free to terminate TLS on one port and forward to another, so the port the
 * browser used (`localhost:3443`, or `3001-myvm.cloudshell.dev`) is not the port
 * the Node process sees. Same host is the same site, which is all CSRF's `Origin`
 * check is about — the scheme and port carry no protection here.
 */
function originHost(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The origins this deployment will accept a state-changing request from.
 *
 * Behind a tunnel the browser's origin (`https://3000-vm.cloudshell.dev`) is not
 * the host the Node process sees (`127.0.0.1:3000`), so the check accepts either
 * the `Host` header or `x-forwarded-host`, on the protocol the browser used — plus
 * an explicit `APP_ORIGIN` allowlist for anything stranger. In development the
 * hosted preview domains are accepted too.
 *
 * Comparison is by host, not by `host:port` (see {@link originHost}), so an edge
 * that terminates TLS on one port and forwards to another still matches.
 */
export function allowedOrigins(request: Request, env: EnvLike = process.env): string[] {
  const origins = new Set<string>();
  const protocol = forwardedProtocol(request);

  let host = '';
  try {
    host = new URL(request.url).host;
  } catch {
    host = '';
  }
  for (const candidate of [request.headers.get('x-forwarded-host'), request.headers.get('host'), host]) {
    if (!candidate) continue;
    origins.add(`${protocol}://${candidate}`);
    origins.add(`https://${candidate}`);
  }

  for (const entry of (env.APP_ORIGIN ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed) origins.add(trimmed);
  }

  return [...origins].map(normalizeOrigin);
}

export interface CsrfResult {
  ok: boolean;
  code?: 'CSRF_HEADER' | 'CSRF_ORIGIN';
  message?: string;
}

/**
 * CSRF defence for state-changing requests.
 *
 * Two independent conditions, both cheap and both deterministic:
 *  1. a custom header (`X-Requested-With`), which a cross-site form cannot set and
 *     a cross-site `fetch` can only set after a preflight this server never
 *     approves; and
 *  2. `Origin`, when the browser sends one, must be this deployment.
 *
 * A request with no `Origin` at all is allowed: browsers always send `Origin` for
 * non-GET, so its absence means a non-browser client — and non-browser clients
 * get no cookies, which is what makes this safe.
 */
export function checkCsrf(request: Request, env: EnvLike = process.env): CsrfResult {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return { ok: true };

  const marker = (request.headers.get('x-requested-with') ?? '').trim().toLowerCase();
  if (marker !== 'xmlhttprequest') {
    return {
      ok: false,
      code: 'CSRF_HEADER',
      message: 'Requests that change data must send X-Requested-With: XMLHttpRequest.',
    };
  }

  const origin = request.headers.get('origin');
  if (!origin) return { ok: true };

  const allowed = allowedOrigins(request, env);
  const normalized = normalizeOrigin(origin);
  const allowedHosts = new Set(allowed.map(originHost).filter(Boolean));
  const matches = allowed.includes(normalized) || allowedHosts.has(originHost(normalized));

  if (!matches && !isProduction(env)) {
    // Hosted previews serve the app from a per-port domain that the VM cannot know
    // in advance; that is a development-only convenience and never applies in
    // production, where the allowlist must name the deployment.
    try {
      const host = new URL(normalized).hostname;
      if (host.endsWith('.cloudshell.dev') || host.endsWith('.e2b.app')) return { ok: true };
    } catch {
      // Fall through to the rejection below.
    }
  }

  if (matches) return { ok: true };

  return {
    ok: false,
    code: 'CSRF_ORIGIN',
    message: `Origin '${origin}' is not allowed. Expected one of: ${allowed.join(', ')}. Set APP_ORIGIN to add it.`,
  };
}

function isProduction(env: EnvLike): boolean {
  return env.NODE_ENV === 'production';
}

interface UpstreamCall {
  path: string;
  search?: string;
  method: string;
  body?: ArrayBuffer;
  requestHeaders: Headers;
  accessToken?: string;
  refreshToken?: string;
  secure: boolean;
}

function buildUpstreamInit(call: UpstreamCall, accessToken: string | undefined): RequestInit {
  const headers: Record<string, string> = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = call.requestHeaders.get(name);
    if (value) headers[name] = value;
  }
  if (!headers.accept) headers.accept = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  return {
    method: call.method,
    headers,
    body: SAFE_METHODS.has(call.method.toUpperCase()) ? undefined : call.body,
    redirect: 'manual',
    cache: 'no-store',
    signal:
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
        : undefined,
  };
}

async function callUpstream(url: string, init: RequestInit, deps: ProxyDeps): Promise<Response> {
  try {
    return await deps.fetchImpl(url, init);
  } catch {
    // A dead API must look like a dead API, not like a 500 in this process.
    return jsonProblem(
      502,
      'UPSTREAM_UNAVAILABLE',
      `The API server did not answer at ${deps.apiTarget}. Is it running?`,
    );
  }
}

/** Exchange a refresh token for a new pair, or `null` when it is no longer valid. */
/**
 * How long a *completed* refresh stays reusable, keyed by the token that was
 * presented.
 *
 * Refresh tokens rotate on every use and the API treats a reused rotated token as
 * theft: it revokes every session for that user. A page load fires several requests
 * at once, and they can arrive with the same cookie value — the first rotates it,
 * and any sibling that arrives moments later would present a revoked token and sign
 * the user out. So a successful rotation is remembered briefly and replayed instead.
 */
const REFRESH_REPLAY_MS = 10_000;

const REFRESH_CACHE_LIMIT = 200;
const refreshesInFlight = new Map<string, Promise<SessionTokens | null>>();
const refreshesDone = new Map<string, { tokens: SessionTokens; expiresAt: number }>();

/** Expired entries are otherwise only dropped when their key comes back. */
function pruneRefreshesDone(): void {
  if (refreshesDone.size < REFRESH_CACHE_LIMIT) return;
  const now = Date.now();
  for (const [key, entry] of refreshesDone) {
    if (entry.expiresAt <= now) refreshesDone.delete(key);
  }
  if (refreshesDone.size >= REFRESH_CACHE_LIMIT) refreshesDone.clear();
}

/** Test hook: forget deduped refreshes (they key on the token value). */
export function resetRefreshCache(): void {
  refreshesInFlight.clear();
  refreshesDone.clear();
}

async function performRefresh(deps: ProxyDeps, refreshToken: string): Promise<SessionTokens | null> {
  const response = await callUpstream(
    `${deps.apiTarget}/api/v1/auth/refresh`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    },
    deps,
  );

  if (!response.ok) return null;
  try {
    const payload = (await response.json()) as { tokens?: SessionTokens };
    return payload.tokens?.accessToken ? payload.tokens : null;
  } catch {
    return null;
  }
}

/**
 * Exchange a refresh token for a new pair, once.
 *
 * Concurrent callers presenting the same token share a single upstream call, and
 * callers presenting a token that was rotated a moment ago are served the result of
 * that rotation. Both exist to keep the API's reuse detection from firing on
 * ordinary page loads.
 */
export function refreshTokens(deps: ProxyDeps, refreshToken: string): Promise<SessionTokens | null> {
  const replayed = refreshesDone.get(refreshToken);
  if (replayed && replayed.expiresAt > Date.now()) return Promise.resolve(replayed.tokens);
  if (replayed) refreshesDone.delete(refreshToken);

  const inFlight = refreshesInFlight.get(refreshToken);
  if (inFlight) return inFlight;

  const pending = performRefresh(deps, refreshToken)
    .then((tokens) => {
      if (tokens) {
        pruneRefreshesDone();
        refreshesDone.set(refreshToken, { tokens, expiresAt: Date.now() + REFRESH_REPLAY_MS });
      }
      return tokens;
    })
    .finally(() => {
      refreshesInFlight.delete(refreshToken);
    });

  refreshesInFlight.set(refreshToken, pending);
  return pending;
}

function toClientResponse(upstream: Response, setCookies: string[]): Response {
  const headers = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  // Never let a browser or an intermediary cache a per-user API response.
  headers.set('cache-control', 'no-store');
  for (const cookie of setCookies) headers.append('set-cookie', cookie);

  const bodyless = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  return new Response(bodyless ? null : upstream.body, { status: upstream.status, headers });
}

/**
 * Forward one call, transparently refreshing an expired access token once.
 *
 * The refresh is the reason this lives on the server: the browser cannot see
 * either token, so it cannot refresh anything itself (ADR-0026).
 */
async function proxyWithRefresh(call: UpstreamCall, deps: ProxyDeps): Promise<Response> {
  const url = `${deps.apiTarget}/api/v1${call.path}${call.search ?? ''}`;
  let response = await callUpstream(url, buildUpstreamInit(call, call.accessToken), deps);
  let setCookies: string[] = [];

  if (response.status === 401 && call.refreshToken) {
    const refreshed = await refreshTokens(deps, call.refreshToken);
    if (refreshed) {
      setCookies = sessionCookies(refreshed, call.secure, deps.env);
      response = await callUpstream(url, buildUpstreamInit(call, refreshed.accessToken), deps);
    } else {
      // The session is over; make the browser stop sending a dead cookie.
      setCookies = clearedSessionCookies(call.secure);
    }
  }

  return toClientResponse(response, setCookies);
}

async function readBody(request: Request): Promise<ArrayBuffer | undefined> {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return undefined;
  try {
    return await request.arrayBuffer();
  } catch {
    return undefined;
  }
}

/** Entry point for `app/api/v1/[...path]/route.ts`. */
export async function handleApiProxy(request: Request, deps: ProxyDeps = proxyDeps()): Promise<Response> {
  const csrf = checkCsrf(request, deps.env);
  if (!csrf.ok) return jsonProblem(403, csrf.code!, csrf.message!);

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/v1/, '') || '/';

  if (TOKEN_MINTING_PATHS.has(path)) {
    return jsonProblem(
      404,
      'NOT_PROXIED',
      'This endpoint returns tokens, so the browser is not allowed to reach it. Use /api/session/*.',
    );
  }

  const { accessToken, refreshToken } = readSessionTokens(request);
  return proxyWithRefresh(
    {
      path,
      search: url.search,
      method: request.method,
      body: await readBody(request),
      requestHeaders: request.headers,
      accessToken,
      refreshToken,
      secure: isSecureRequest(request, deps.env),
    },
    deps,
  );
}

type SessionAction = 'login' | 'register' | 'refresh' | 'logout' | 'me';

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface LoginPayload {
  tokens: SessionTokens;
  user: unknown;
  organization: unknown;
  role?: string;
  memberships?: unknown;
}

/** What the browser is told about a session: identity, never credentials. */
function publicSession(payload: LoginPayload): Record<string, unknown> {
  return {
    user: payload.user,
    organization: payload.organization,
    role: payload.role ?? '',
    memberships: payload.memberships ?? [],
  };
}

async function sessionStart(
  request: Request,
  deps: ProxyDeps,
  action: 'login' | 'register',
): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return jsonProblem(400, 'INVALID_BODY', 'Expected a JSON request body.');

  const upstream = await callUpstream(
    `${deps.apiTarget}/api/v1/auth/${action}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
    deps,
  );

  if (!upstream.ok) {
    // Pass the API's own error envelope through so the form can show it verbatim.
    return toClientResponse(upstream, []);
  }

  const payload = (await upstream.json()) as LoginPayload;
  if (!payload.tokens?.accessToken) {
    return jsonProblem(502, 'UPSTREAM_INVALID', 'The API did not return a session.');
  }

  const secure = isSecureRequest(request, deps.env);
  return jsonResponse(publicSession(payload), 200, sessionCookies(payload.tokens, secure, deps.env));
}

async function sessionRefresh(request: Request, deps: ProxyDeps): Promise<Response> {
  const { refreshToken } = readSessionTokens(request);
  const secure = isSecureRequest(request, deps.env);
  if (!refreshToken) return jsonProblem(401, 'NO_SESSION', 'There is no session to refresh.');

  const tokens = await refreshTokens(deps, refreshToken);
  if (!tokens) {
    return jsonResponse(
      { error: { code: 'SESSION_EXPIRED', message: 'Please sign in again.' } },
      401,
      clearedSessionCookies(secure),
    );
  }

  return jsonResponse({ ok: true }, 200, sessionCookies(tokens, secure, deps.env));
}

async function sessionLogout(request: Request, deps: ProxyDeps): Promise<Response> {
  const { accessToken, refreshToken } = readSessionTokens(request);
  const secure = isSecureRequest(request, deps.env);

  if (accessToken || refreshToken) {
    // Best effort: the cookies are cleared either way, so a failing API call must
    // not leave the user signed in.
    await callUpstream(
      `${deps.apiTarget}/api/v1/auth/logout`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      },
      deps,
    );
  }

  return emptyResponse(204, clearedSessionCookies(secure));
}

async function sessionMe(request: Request, deps: ProxyDeps): Promise<Response> {
  const { accessToken, refreshToken } = readSessionTokens(request);
  if (!accessToken && !refreshToken) return jsonProblem(401, 'NO_SESSION', 'Not signed in.');

  return proxyWithRefresh(
    {
      path: '/auth/me',
      method: 'GET',
      requestHeaders: request.headers,
      accessToken,
      refreshToken,
      secure: isSecureRequest(request, deps.env),
    },
    deps,
  );
}

/** Entry point for `app/api/session/[...action]/route.ts`. */
export async function handleSession(request: Request, deps: ProxyDeps = proxyDeps()): Promise<Response> {
  const csrf = checkCsrf(request, deps.env);
  if (!csrf.ok) return jsonProblem(403, csrf.code!, csrf.message!);

  const action = new URL(request.url).pathname
    .replace(/^\/api\/session\/?/, '')
    .replace(/\/+$/, '') as SessionAction;

  if (request.method === 'GET' && action === 'me') return sessionMe(request, deps);
  if (request.method !== 'POST') return jsonProblem(405, 'METHOD_NOT_ALLOWED', 'Unsupported method.');

  switch (action) {
    case 'login':
    case 'register':
      return sessionStart(request, deps, action);
    case 'refresh':
      return sessionRefresh(request, deps);
    case 'logout':
      return sessionLogout(request, deps);
    default:
      return jsonProblem(404, 'NOT_FOUND', `Unknown session action '${action}'.`);
  }
}
