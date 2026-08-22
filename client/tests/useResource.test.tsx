import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useResource } from '../src/hooks/useResource';

describe('useResource', () => {
  it('starts loading, then exposes data', async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: 1 }]);
    const { result } = renderHook(() => useResource(fetcher));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ id: 1 }]);
    expect(result.current.error).toBeNull();
  });

  it('exposes a message when the fetch rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useResource(fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.data).toBeNull();
  });

  it('does not set state after unmount', async () => {
    let resolve: (value: unknown) => void = () => {};
    const fetcher = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((e) => errors.push(e));

    const { unmount } = renderHook(() => useResource(fetcher));
    unmount();
    resolve([{ id: 1 }]);
    await Promise.resolve();

    expect(errors).toHaveLength(0);
    spy.mockRestore();
  });

  it('refetches on refresh and keeps the previous data meanwhile', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const { result } = renderHook(() => useResource(fetcher));

    await waitFor(() => expect(result.current.data).toEqual([{ id: 1 }]));

    act(() => result.current.refresh());
    // A refresh must not flash the caller back to a loading state — the table
    // would blank out after every delete.
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([{ id: 1 }]);

    await waitFor(() => expect(result.current.data).toEqual([{ id: 1 }, { id: 2 }]));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not refetch when the caller passes a new closure each render', async () => {
    const inner = vi.fn().mockResolvedValue([]);
    const { result, rerender } = renderHook(() => useResource(() => inner()));

    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    rerender();

    // An inline closure changes identity every render; holding it in a ref is
    // what stops that becoming an infinite refetch loop.
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
