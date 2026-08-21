import { AlbumCard } from '../components/AlbumCard';
import { Button } from '../components/ui/Button';
import { RECENT_WINDOW_LABEL, TOTAL_RECORDS, recentRecords } from '../data/collection';
import styles from './RecentlyAdded.module.css';

export function RecentlyAdded(): JSX.Element {
  return (
    <section className={styles.section} aria-labelledby="recently-added">
      <div className={styles.inner}>
        <div className={styles.headerRow}>
          <h2 className={styles.heading} id="recently-added">
            Recently Added
          </h2>
          <span className={styles.aside}>{RECENT_WINDOW_LABEL}</span>
        </div>

        <ul className={styles.grid}>
          {recentRecords.map((record) => (
            <li key={record.id}>
              <AlbumCard record={record} variant="compact" href={`/records/${record.slug}`} />
            </li>
          ))}
        </ul>

        <div className={styles.footer}>
          <Button href="#featured" variant="secondary" size="lg" className={styles.viewAll}>
            View All {TOTAL_RECORDS} Records
          </Button>
        </div>
      </div>
    </section>
  );
}
