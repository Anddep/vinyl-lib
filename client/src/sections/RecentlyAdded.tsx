import { AlbumCard } from '../components/AlbumCard';
import { Button } from '../components/ui/Button';
import type { VinylRecord } from '../types/collection';
import styles from './RecentlyAdded.module.css';

interface RecentlyAddedProps {
  records: VinylRecord[];
  total: number;
  windowLabel: string;
  error: string | null;
}

export function RecentlyAdded({
  records,
  total,
  windowLabel,
  error,
}: RecentlyAddedProps): JSX.Element {
  return (
    <section className={styles.section} aria-labelledby="recently-added">
      <div className={styles.inner}>
        <div className={styles.headerRow}>
          <h2 className={styles.heading} id="recently-added">
            Recently Added
          </h2>
          <span className={styles.aside}>{windowLabel}</span>
        </div>

        {error ? (
          <p className={styles.message}>Could not load recent additions just now.</p>
        ) : (
          <ul className={styles.grid}>
            {records.map((record) => (
              <li key={record.id}>
                <AlbumCard record={record} variant="compact" />
              </li>
            ))}
          </ul>
        )}

        <div className={styles.footer}>
          <Button href="#collection" variant="secondary" size="lg" className={styles.viewAll}>
            View All {total} {total === 1 ? 'Record' : 'Records'}
          </Button>
        </div>
      </div>
    </section>
  );
}
