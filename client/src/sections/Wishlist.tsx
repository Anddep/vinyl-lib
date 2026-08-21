import { WishlistCard } from '../components/AlbumCard';
import { Button } from '../components/ui/Button';
import { wishlist } from '../data/collection';
import styles from './Wishlist.module.css';

export function Wishlist(): JSX.Element {
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
          <Button href="#contact">Have one of these?</Button>
        </div>

        <ul className={styles.grid}>
          {wishlist.map((item) => (
            <li key={item.id}>
              <WishlistCard item={item} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
