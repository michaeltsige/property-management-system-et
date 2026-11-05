'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError, fieldErrorsOf } from './api';

/** How often a pending payment is re-verified with the provider, and for how long. */
const WATCH_INTERVAL_MS = 5_000;
const WATCH_MAX_ATTEMPTS = 100;

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetch-on-mount with an explicit reload.
 *
 * Deliberately small: the app has one data source (our own REST API) and no
 * cache-coherency requirements that would justify a data library. `deps` behaves
 * like `useEffect`'s, so a changed filter refetches.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader()
      .then((result) => {
        if (!cancelled && mounted.current) setData(result);
      })
      .catch((cause: unknown) => {
        if (cancelled || !mounted.current) return;
        setError(cause instanceof ApiError ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}

/**
 * Open a screen's create dialog when it is reached from a dashboard quick action
 * (`?new=1`), then clean the query string so a refresh, a bookmark or a
 * back-navigation does not re-open it.
 *
 * It reads `window.location` instead of `useSearchParams` on purpose: a client
 * page that calls `useSearchParams` must be wrapped in a Suspense boundary to be
 * prerendered, which would be a steep price for one query parameter.
 */
export function useAutoOpenModal(open: () => void, param = 'new') {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(param) !== '1') return;
    open();
    params.delete(param);
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    // Runs once per mount: the URL is cleaned immediately afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);
}

/**
 * Keep the document title in sync with the current screen.
 *
 * The title is announced by screen readers when the route changes and names the
 * tab in the browser history, so every page sets one (see ADR-0024).
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** A single in-flight action (submit buttons), with its error surfaced inline. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Validation failures mapped onto field paths: { phone: 'Expected an Ethiopian…' }. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const run = useCallback(async (task: () => Promise<void>) => {
    setPending(true);
    setError(null);
    setMessage(null);
    setFieldErrors({});
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : String(cause));
      setFieldErrors(fieldErrorsOf(cause));
      throw cause;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, message, setMessage, fieldErrors, run };
}

/**
 * While a provider payment attempt is pending, re-verify it with the provider
 * every few seconds and complete it the moment the money is confirmed.
 *
 * Chapa (v1 and v2) only redirects the payer back to an https origin, so on an
 * http deployment the hosted checkout cannot send the tenant home — the
 * tenant finishes paying in another tab and this watch is what notices.
 * Before it existed the tenant had to come back and press "check payment
 * status" by hand. Gives up after WATCH_MAX_ATTEMPTS so an abandoned checkout
 * does not ping the provider forever; the manual button still works.
 *
 * Returns true while the watch is actively polling.
 */
export function usePendingPaymentWatch(
  pending: { providerRef: string } | null | undefined,
  onConfirmed: () => void,
): boolean {
  const providerRef = pending?.providerRef ?? null;
  const [watching, setWatching] = useState(false);
  // The callback changes every render (inline arrow); the effect must not.
  const confirmedRef = useRef(onConfirmed);
  confirmedRef.current = onConfirmed;

  useEffect(() => {
    if (!providerRef) {
      setWatching(false);
      return;
    }
    let cancelled = false;
    let stopped = false;
    let attempts = 0;
    setWatching(true);

    const finish = () => {
      if (cancelled) return;
      cancelled = true; // no further state updates or callbacks
      stopped = true;
      setWatching(false);
      confirmedRef.current();
    };

    const verify = async (): Promise<boolean> => {
      attempts += 1;
      try {
        await api.portalCompletePayment(providerRef);
        finish();
        return true;
      } catch (cause) {
        // "Already been completed" — a parallel tab or the webhook beat this
        // watch to it; either way the money is in. Anything else (provider has
        // not confirmed yet, network blip) keeps the watch running.
        if (cause instanceof ApiError && /already been completed/i.test(cause.message)) {
          finish();
          return true;
        }
        return false;
      }
    };

    void (async () => {
      while (!stopped && attempts < WATCH_MAX_ATTEMPTS) {
        const done = await verify();
        if (done || stopped) return;
        await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
      }
      if (!cancelled) setWatching(false);
    })();

    return () => {
      stopped = true;
      cancelled = true;
    };
  }, [providerRef]);

  return watching;
}
