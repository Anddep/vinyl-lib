import { useState } from 'react';
import type { Genre } from '../api/client';
import { AlbumCard } from '../components/AlbumCard';
import { FilterChip } from '../components/ui/FilterChip';
import type { VinylRecord } from '../types/collection';
import styles from './CollectionHighlights.module.css';

const ALL = 'All';

interface CollectionHighlightsProps {
  records: VinylRecord[];
  genres: Genre[];
  total: number;
  error: string | null;
}

export function CollectionHighlights({
  records,
  genres,
  total,
  error,
}: CollectionHighlightsProps): JSX.Element {
  const [selectedGenre, setSelectedGenre] = useState<string>(ALL);

  // Derived during render rather than stored — a `visibleRecords` state kept
  // in sync with the filter is exactly the bug this avoids.
  const visibleRecords =
    selectedGenre === ALL ? records : records.filter((record) => record.genre === selectedGenre);

  return (
    <>
      <section className={styles.section} id="collection">
        <div className={styles.inner}>
          <div className={styles.headerRow}>
            <h2 className={styles.heading}>Collection Highlights</h2>
            {/* role=status announces the count as the filter changes, so
                filtering is not silent for screen reader users. */}
            <span className={styles.counter} role="status">
              {visibleRecords.length} of {total} shown
            </span>
          </div>

          <div className={styles.panel}>
            <div className={styles.row} role="group" aria-label="Filter by genre">
              <span className={styles.rowLabel} aria-hidden="true">
                Genre
              </span>
              {/* Chips come from the genres actually in the collection, so one
                  added in the admin appears here without a code change. */}
              <FilterChip
                label={ALL}
                selected={selectedGenre === ALL}
                onToggle={() => setSelectedGenre(ALL)}
              />
              {genres.map((genre) => (
                <FilterChip
                  key={genre.name}
                  label={genre.name}
                  count={genre.count}
                  selected={selectedGenre === genre.name}
                  onToggle={() => setSelectedGenre(genre.name)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.gridSection} aria-label="The collection">
        {error ? (
          <p className={styles.empty}>Could not load the collection just now.</p>
        ) : visibleRecords.length > 0 ? (
          <ul className={styles.grid}>
            {visibleRecords.map((record) => (
              <li key={record.id}>
                <AlbumCard record={record} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Nothing in the highlights matches that filter yet.</p>
        )}
      </section>
    </>
  );
}
