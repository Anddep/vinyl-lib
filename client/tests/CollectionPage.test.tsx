import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionPage } from '../src/pages/CollectionPage';

const PROFILE = { slug: 'andriy', displayName: 'Andriy', avatarUrl: null };
const RECORD = {
  id: 1,
  slug: 'kind-of-blue',
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  year: 1959,
  format: 'LP',
  genre: 'Jazz',
  url: 'https://www.discogs.com/release/1',
};

/** Answers every endpoint the page fetches on mount. */
function mockCollection({ profileStatus = 200, records = [RECORD] } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url === '/api/u/andriy') {
      return profileStatus === 200 ? json(PROFILE) : json({ error: 'Not found' }, profileStatus);
    }
    if (url.includes('/records')) return json(records);
    if (url.includes('/stats')) {
      return json({
        totalRecords: records.length,
        topGenre: { name: 'Jazz', count: 1 },
        topArtist: { name: 'Miles Davis', count: 1 },
        collectingSince: '2009',
        addedLast30Days: 1,
      });
    }
    if (url.includes('/genres')) return json([{ name: 'Jazz', count: 1 }]);
    if (url.includes('/settings')) return json({});
    return json([]);
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/u/:slug" element={<CollectionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelectorAll('meta[name="robots"]').forEach((tag) => tag.remove());
});

describe('CollectionPage', () => {
  it('fetches from the slug in the URL, not from the global routes', async () => {
    const fetchStub = mockCollection();

    renderAt('/u/andriy');

    expect(await screen.findAllByText('Kind of Blue')).not.toHaveLength(0);
    const called = fetchStub.mock.calls.map(([url]) => String(url));
    expect(called).toContain('/api/u/andriy/records');
    expect(called.some((url) => url === '/api/records')).toBe(false);
  });

  it('titles the document with the collector name', async () => {
    mockCollection();

    renderAt('/u/andriy');

    await screen.findAllByText('Kind of Blue');
    expect(document.title).toBe('Andriy · Grooves & Dust');
  });

  it('keeps the site wordmark rather than renaming the site per collector', async () => {
    mockCollection();

    renderAt('/u/andriy');

    await screen.findAllByText('Kind of Blue');
    expect(screen.getAllByText(/Grooves & Dust/).length).toBeGreaterThan(0);
  });

  it('shows a not-found screen when the collection is unknown, private or suspended', async () => {
    mockCollection({ profileStatus: 404 });

    renderAt('/u/andriy');

    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
    expect(screen.queryAllByText('Kind of Blue')).toHaveLength(0);
  });

  it('does not index a collection with fewer than three records', async () => {
    mockCollection();

    renderAt('/u/andriy');

    await screen.findAllByText('Kind of Blue');
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
  });

  it('lets a collection with enough records be indexed', async () => {
    const many = [1, 2, 3, 4].map((id) => ({ ...RECORD, id, slug: `r${id}`, title: `R${id}` }));
    mockCollection({ records: many });

    renderAt('/u/andriy');

    await screen.findAllByText('R1');
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});
