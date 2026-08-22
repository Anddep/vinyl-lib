import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CollectionHighlights } from '../src/sections/CollectionHighlights';
import type { VinylRecord } from '../src/types/collection';

const records: VinylRecord[] = [
  {
    id: 1,
    slug: 'a',
    title: 'Bitches Brew',
    artist: 'Miles Davis',
    year: 1970,
    format: '2×LP',
    genre: 'Jazz',
  },
  {
    id: 2,
    slug: 'b',
    title: 'Mezzanine',
    artist: 'Massive Attack',
    year: 1998,
    format: 'LP',
    genre: 'Electronic',
  },
  {
    id: 3,
    slug: 'c',
    title: 'Blue Train',
    artist: 'John Coltrane',
    year: 1958,
    format: 'LP',
    genre: 'Jazz',
  },
];

const genres = [
  { name: 'Electronic', count: 1 },
  { name: 'Jazz', count: 2 },
];

function renderSection(overrides = {}) {
  return render(
    <CollectionHighlights
      records={records}
      genres={genres}
      total={14}
      error={null}
      {...overrides}
    />,
  );
}

describe('CollectionHighlights', () => {
  it('builds its chips from the genres the API reports', () => {
    renderSection();

    // "All" plus one chip per genre in use — nothing hardcoded.
    expect(screen.getByRole('button', { name: /^All$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Electronic/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jazz/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('shows a genre invented in the admin without any code change', () => {
    renderSection({ genres: [...genres, { name: 'Dub', count: 1 }] });

    expect(screen.getByRole('button', { name: /Dub/ })).toBeInTheDocument();
  });

  it('filters the grid and updates the counter', async () => {
    renderSection();

    expect(screen.getByRole('status')).toHaveTextContent('3 of 14 shown');

    await userEvent.click(screen.getByRole('button', { name: /Jazz/ }));

    expect(screen.getByRole('status')).toHaveTextContent('2 of 14 shown');
    expect(screen.getByText('Bitches Brew')).toBeInTheDocument();
    expect(screen.queryByText('Mezzanine')).toBeNull();
  });

  it('returns to the full list via All', async () => {
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: /Jazz/ }));
    await userEvent.click(screen.getByRole('button', { name: /^All$/ }));

    expect(screen.getByRole('status')).toHaveTextContent('3 of 14 shown');
  });

  it('marks the active chip with aria-pressed', async () => {
    renderSection();

    expect(screen.getByRole('button', { name: /^All$/ })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: /Jazz/ }));

    expect(screen.getByRole('button', { name: /Jazz/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^All$/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the section heading when the fetch failed', () => {
    renderSection({ error: 'network down', records: [] });

    expect(screen.getByText('Collection Highlights')).toBeInTheDocument();
    expect(screen.getByText(/could not load the collection/i)).toBeInTheDocument();
  });
});
