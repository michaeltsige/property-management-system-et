'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from './api';

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

/** A single in-flight action (submit buttons), with its error surfaced inline. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async (task: () => Promise<void>) => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : String(cause));
      throw cause;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, message, setMessage, run };
}
