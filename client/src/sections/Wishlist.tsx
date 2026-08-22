import { WishlistCard } from '../components/AlbumCard';
import type { WishlistItem } from '../types/collection';
import styles from './Wishlist.module.css';

interface WishlistProps {
  items: WishlistItem[];
  error: string | null;
}

export function Wishlist({ items, error }: WishlistProps): JSX.Element {
  return (
    <section className={styles.section} aria-labelledby="wishlist-heading">
      <div className={styles.inner}>
        <div className={styles.headerRow}>
          <div className={styles.headingGroup}>
            <h2 className={styles.heading} id="wishlist-heading">
              Looking For
            </h2>
            <p className={styles.sub}>
              Six records I&apos;ve been chasing for years. Condition matters less than the
              pressing.
            </p>
          </div>
        </div>

        {error && <p className={styles.message}>Could not load the wishlist just now.</p>}

        <ul className={styles.grid}>
          {items.map((item) => (
            <li key={item.id}>
              <WishlistCard item={item} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
