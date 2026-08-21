import { StatCard } from '../components/StatCard';
import { collectionStats } from '../data/collection';
import styles from './QuickStats.module.css';

export function QuickStats(): JSX.Element {
  return (
    <section className={styles.section} aria-label="Collection at a glance">
      <ul className={styles.grid}>
        {collectionStats.map((stat) => (
          <li key={stat.id}>
            <StatCard stat={stat} />
          </li>
        ))}
      </ul>
    </section>
  );
}
