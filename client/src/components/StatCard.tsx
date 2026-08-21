import type { CollectionStat } from '../types/collection';
import { StatIcon } from './ui/icons';
import styles from './StatCard.module.css';

export function StatCard({ stat }: { stat: CollectionStat }): JSX.Element {
  return (
    <div className={styles.card}>
      <span className={styles.icon}>
        <StatIcon name={stat.icon} />
      </span>
      <span className={styles.value}>{stat.value}</span>
      <span className={styles.label}>{stat.label}</span>
    </div>
  );
}
