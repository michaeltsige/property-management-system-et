// @vitest-environment node
/**
 * The GET deduplication in `apiFetch`: concurrent duplicates share one request,
 * sequential calls never share, and nothing else changes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from './api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Pending resolvers; tests must release them so nothing bleeds across tests. */
const gates: (() => void)[] = [];

function pendingFetch() {
  return vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        gates.push(() => resolve(jsonResponse({ ok: true })));
      }),
  );
}

function releaseAll() {
  for (const release of gates.splice(0)) release();
}

afterEach(() => {
  releaseAll();
  vi.unstubAllGlobals();
});

describe('apiFetch GET deduplication', () => {
  it('shares one request between concurrent identical GETs', async () => {
    const fetchImpl = pendingFetch();
    vi.stubGlobal('fetch', fetchImpl);

    const first = apiFetch('/properties');
    const second = apiFetch('/properties');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    releaseAll();
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('fetches again once the shared request has settled', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchImpl);

    await apiFetch('/units');
    await apiFetch('/units');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never deduplicates across different paths', async () => {
    const fetchImpl = pendingFetch();
    vi.stubGlobal('fetch', fetchImpl);

    const a = apiFetch('/charges');
    const b = apiFetch('/tenants');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    releaseAll();
    await Promise.all([a, b]);
  });

  it('never deduplicates writes', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 201));
    vi.stubGlobal('fetch', fetchImpl);

    await Promise.all([
      apiFetch('/tenants', { method: 'POST', body: {} }),
      apiFetch('/tenants', { method: 'POST', body: {} }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('leaves requests with an AbortSignal to themselves', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchImpl);
    const controller = new AbortController();

    await Promise.all([apiFetch('/leases'), apiFetch('/leases', { signal: controller.signal })]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('clears the shared slot after a failure so a retry hits the network', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'BOOM', message: 'boom' } }, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchImpl);

    await expect(apiFetch('/payments')).rejects.toThrow('boom');
    await expect(apiFetch('/payments')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
