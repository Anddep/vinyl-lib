import { renderHook, waitFor } from '@testing-library/react';
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
});
