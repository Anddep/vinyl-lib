import type { Stats } from '../api/client';
import { StatCard } from '../components/StatCard';
import type { CollectionStat } from '../types/collection';
import styles from './QuickStats.module.css';

/** "1 record" rather than "1 records" — visible as soon as a card has one. */
function plural(count: number): string {
  return count === 1 ? '1 record' : `${count} records`;
}

/** Builds the four cards from the computed figures. */
function toCards(stats: Stats): CollectionStat[] {
  return [
    {
      id: 'total',
      icon: 'disc',
      value: String(stats.totalRecords),
      label: 'Total records',
    },
    {
      id: 'genre',
      icon: 'bars',
      value: stats.topGenre?.name ?? '—',
      label: stats.topGenre ? `Top genre · ${plural(stats.topGenre.count)}` : 'Top genre',
    },
    {
      id: 'artist',
      icon: 'square',
      value: stats.topArtist?.name ?? '—',
      label: stats.topArtist ? `Top artist · ${plural(stats.topArtist.count)}` : 'Top artist',
    },
    {
      id: 'since',
      icon: 'sleeve',
      value: stats.collectingSince ?? '—',
      label: 'Collecting since',
    },
  ];
}

/** Empty cards at full size, so the grid holds its height while stats load. */
const SKELETON: CollectionStat[] = [
  { id: 's0', icon: 'disc', value: '', label: '' },
  { id: 's1', icon: 'bars', value: '', label: '' },
  { id: 's2', icon: 'square', value: '', label: '' },
  { id: 's3', icon: 'sleeve', value: '', label: '' },
];

export function QuickStats({ stats }: { stats: Stats | null }): JSX.Element {
  const cards = stats ? toCards(stats) : SKELETON;

  return (
    <section className={styles.section} aria-label="Collection at a glance">
      <ul className={styles.grid}>
        {cards.map((stat) => (
          <li key={stat.id}>
            <StatCard stat={stat} />
          </li>
        ))}
      </ul>
    </section>
  );
}
