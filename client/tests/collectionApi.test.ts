import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectionApi } from '../src/api/client';

function stubFetch() {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
}

afterEach(() => vi.restoreAllMocks());

describe('collectionApi', () => {
  it('reads the signed-in user own collection from the unprefixed routes', async () => {
    const fetchStub = stubFetch();

    await collectionApi({ kind: 'own' }).getRecords();

    expect(fetchStub).toHaveBeenCalledWith('/api/records', expect.anything());
  });

  it('reads a public collection from its slug', async () => {
    const fetchStub = stubFetch();

    await collectionApi({ kind: 'public', slug: 'andriy' }).getRecords();

    expect(fetchStub).toHaveBeenCalledWith('/api/u/andriy/records', expect.anything());
  });

  it('encodes a slug rather than pasting it into the path', async () => {
    const fetchStub = stubFetch();

    await collectionApi({ kind: 'public', slug: 'a/../b' }).getStats();

    expect(fetchStub).toHaveBeenCalledWith('/api/u/a%2F..%2Fb/stats', expect.anything());
  });

  it('keeps the recent-records query on the scoped path', async () => {
    const fetchStub = stubFetch();

    await collectionApi({ kind: 'public', slug: 'andriy' }).getRecentRecords();

    expect(fetchStub).toHaveBeenCalledWith(
      '/api/u/andriy/records?sort=addedAt&limit=6',
      expect.anything(),
    );
  });

  it('offers the same seven reads whichever scope it is built for', () => {
    const own = collectionApi({ kind: 'own' });
    const other = collectionApi({ kind: 'public', slug: 'andriy' });

    expect(Object.keys(own).sort()).toEqual(Object.keys(other).sort());
    expect(Object.keys(own)).toHaveLength(7);
  });
});
