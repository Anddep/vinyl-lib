import { Link } from 'react-router-dom';
import { getSetup, getStats, getWishlist } from '../api/client';
import { useResource } from '../hooks/useResource';
import styles from './DashboardPage.module.css';

export default function DashboardPage(): JSX.Element {
  const stats = useResource(getStats);
  const wishlist = useResource(getWishlist);
  const setup = useResource(getSetup);

  const tiles = [
    { to: '/admin/records', label: 'Records', value: stats.data?.totalRecords },
    { to: '/admin/wishlist', label: 'Wishlist', value: wishlist.data?.length },
    { to: '/admin/setup', label: 'Setup rows', value: setup.data?.length },
  ];

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.heading}>Dashboard</h1>
        <p className={styles.sub}>
          {stats.data
            ? `Top genre: ${stats.data.topGenre?.name ?? '—'} · ${stats.data.addedLast30Days} added in the last 30 days`
            : 'Loading collection figures…'}
        </p>
      </div>

      <ul className={styles.grid}>
        {tiles.map((tile) => (
          <li key={tile.to}>
            <Link className={styles.tile} to={tile.to}>
              {/* An em dash rather than 0 while loading: 0 is a real answer
                  and would read as "you have none". */}
              <span className={styles.value}>{tile.value ?? '—'}</span>
              <span className={styles.label}>{tile.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
