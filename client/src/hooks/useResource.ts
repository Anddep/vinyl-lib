import { useCallback, useEffect, useRef, useState } from 'react';

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export interface Resource<T> extends ResourceState<T> {
  /** Refetch, keeping the current data on screen until the new data lands. */
  refresh: () => void;
}

/**
 * Fetch on mount, and again whenever `refresh()` is called.
 *
 * The fetcher is held in a ref so that passing an inline closure cannot send
 * the effect into a refetch loop. The ref is synced inside an effect rather
 * than during render: React's docs are explicit that writing `ref.current`
 * while rendering breaks purity expectations.
 *
 * `loading` only covers the first load. A refresh after a mutation leaves the
 * existing rows on screen rather than flashing the table back to empty.
 */
export function useResource<T>(fetcher: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    error: null,
    loading: true,
  });
  const [reloadCount, setReloadCount] = useState(0);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    // Stops a late response from setting state after unmount, and — under
    // StrictMode's double-invoke — from letting the first render's response
    // land on top of the second's.
    let cancelled = false;

    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) {
          setState({ data, error: null, loading: false });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            error: error instanceof Error ? error.message : 'Unknown error',
            loading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  const refresh = useCallback(() => setReloadCount((count) => count + 1), []);

  return { ...state, refresh };
}
