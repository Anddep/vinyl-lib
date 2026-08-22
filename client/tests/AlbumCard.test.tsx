import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlbumCard } from '../src/components/AlbumCard';
import type { VinylRecord } from '../src/types/collection';

const record: VinylRecord = {
  id: 1,
  slug: 'bitches-brew',
  title: 'Bitches Brew',
  artist: 'Miles Davis',
  year: 1970,
  format: '2×LP',
  genre: 'Jazz',
};

describe('AlbumCard', () => {
  it('renders a safe external anchor when the record has a url', () => {
    render(<AlbumCard record={{ ...record, url: 'https://www.discogs.com/release/1481' }} />);

    const link = screen.getByRole('link', { name: /Bitches Brew by Miles Davis/i });
    expect(link).toHaveAttribute('href', 'https://www.discogs.com/release/1481');
    expect(link).toHaveAttribute('target', '_blank');
    // Without noopener the opened page can navigate this tab via window.opener.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders no link at all when the record has no url', () => {
    render(<AlbumCard record={record} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Bitches Brew')).toBeInTheDocument();
  });

  it('formats the spec line from the record fields', () => {
    render(<AlbumCard record={record} />);

    expect(screen.getByText('1970 · 2×LP · JAZZ')).toBeInTheDocument();
  });

  it('derives the compact date label from addedAt', () => {
    render(
      <AlbumCard record={{ ...record, addedAt: '2026-08-18T00:00:00.000Z' }} variant="compact" />,
    );

    expect(screen.getByText('Added 18 Aug')).toBeInTheDocument();
  });

  it('renders a real cover image when coverUrl is set', () => {
    render(<AlbumCard record={{ ...record, coverUrl: '/uploads/abc.png' }} />);

    expect(screen.getByRole('img', { name: /Bitches Brew/i })).toHaveAttribute(
      'src',
      '/uploads/abc.png',
    );
  });
});
