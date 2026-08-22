import { useEffect, useState } from 'react';

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Fetch once on mount.
 *
 * The `cancelled` flag stops a late response from setting state after unmount,
 * which under StrictMode's double-invoke would otherwise let the first render's
 * response land on top of the second's.
 */
export function useResource<T>(fetcher: () => Promise<T>): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    fetcher()
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
    // The fetcher is a module-level function per call site; re-running on
    // identity change would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
