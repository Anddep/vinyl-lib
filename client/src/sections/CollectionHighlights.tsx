import { useState } from 'react';
import { AlbumCard } from '../components/AlbumCard';
import { FilterChip } from '../components/ui/FilterChip';
import { DECADE_FILTERS, GENRE_FILTERS, TOTAL_RECORDS, featuredRecords } from '../data/collection';
import styles from './CollectionHighlights.module.css';

export function CollectionHighlights(): JSX.Element {
  const [selectedGenre, setSelectedGenre] = useState<string>('All');
  const [selectedDecade, setSelectedDecade] = useState<number | null>(null);

  // Derived during render rather than stored — keeping a `visibleRecords` state
  // in sync with two filters is exactly the bug this avoids.
  const visibleRecords = featuredRecords.filter((record) => {
    const genreMatches = selectedGenre === 'All' || record.genre === selectedGenre;
    const decadeMatches =
      selectedDecade === null ||
      (record.year >= selectedDecade && record.year < selectedDecade + 10);
    return genreMatches && decadeMatches;
  });

  return (
    <>
      <section className={styles.section} id="featured">
        <div className={styles.inner}>
          <div className={styles.headerRow}>
            <h2 className={styles.heading}>Collection Highlights</h2>
            {/* Announce the count as it changes so filtering is not silent for
                screen reader users. */}
            <span className={styles.counter} role="status">
              {visibleRecords.length} of {TOTAL_RECORDS} shown
            </span>
          </div>

          <div className={styles.panel}>
            <div className={styles.row} role="group" aria-label="Filter by genre">
              <span className={styles.rowLabel} aria-hidden="true">
                Genre
              </span>
              {GENRE_FILTERS.map((genre) => (
                <FilterChip
                  key={genre.value}
                  label={genre.label}
                  selected={selectedGenre === genre.value}
                  onToggle={() => setSelectedGenre(genre.value)}
                />
              ))}
            </div>

            <div className={styles.row} role="group" aria-label="Filter by decade">
              <span className={styles.rowLabel} aria-hidden="true">
                Decade
              </span>
              {DECADE_FILTERS.map((decade) => (
                <FilterChip
                  key={decade.value}
                  label={decade.label}
                  shape="square"
                  selected={selectedDecade === decade.value}
                  // Single-select, but clicking the active chip clears it —
                  // otherwise there is no way back to an unfiltered grid.
                  onToggle={() =>
                    setSelectedDecade((current) => (current === decade.value ? null : decade.value))
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.gridSection} aria-label="Featured records">
        {visibleRecords.length > 0 ? (
          <ul className={styles.grid}>
            {visibleRecords.map((record) => (
              <li key={record.id}>
                <AlbumCard record={record} href={`/records/${record.slug}`} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Nothing in the highlights matches those filters yet.</p>
        )}
      </section>
    </>
  );
}
