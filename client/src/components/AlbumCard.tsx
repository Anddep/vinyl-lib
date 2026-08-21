import type { ReactNode } from 'react';
import type { VinylRecord, WishlistItem } from '../types/collection';
import { ImagePlaceholder } from './ui/ImagePlaceholder';
import { EmptyRingIcon } from './ui/icons';
import styles from './AlbumCard.module.css';

/** Formats the mono spec line: "1970 · 2×LP · JAZZ". */
function specLine(record: VinylRecord): string {
  return `${record.year} · ${record.format} · ${record.genre.toUpperCase()}`;
}

interface CardShellProps {
  href?: string;
  variant: 'default' | 'compact' | 'wishlist';
  label: string;
  children: ReactNode;
}

function CardShell({ href, variant, label, children }: CardShellProps): JSX.Element {
  const classes = [styles.card, styles[variant], href ? styles.linked : null]
    .filter(Boolean)
    .join(' ');

  if (href) {
    return (
      <a className={classes} href={href} aria-label={label}>
        {children}
      </a>
    );
  }

  return <article className={classes}>{children}</article>;
}

interface AlbumCardProps {
  record: VinylRecord;
  variant?: 'default' | 'compact';
  /** Record detail route. Omit to render a non-interactive card. */
  href?: string;
}

export function AlbumCard({ record, variant = 'default', href }: AlbumCardProps): JSX.Element {
  const isCompact = variant === 'compact';

  return (
    <CardShell href={href} variant={variant} label={`${record.title} by ${record.artist}`}>
      <ImagePlaceholder ratio="1" variant="cover" caption="cover 300×300" className={styles.cover}>
        {record.isNew && <span className={styles.badge}>New</span>}
        <span
          className={[styles.overlay, isCompact ? styles.overlayFlat : styles.overlayGradient].join(
            ' ',
          )}
          aria-hidden="true"
        >
          <span className={[styles.pill, isCompact ? styles.pillCompact : null].join(' ')}>
            {isCompact ? 'View' : 'View Details'}
          </span>
        </span>
      </ImagePlaceholder>

      <div className={styles.meta}>
        <span className={styles.title}>{record.title}</span>
        <span className={styles.artist}>{record.artist}</span>
        <span className={styles.spec}>{isCompact ? record.addedLabel : specLine(record)}</span>
        {!isCompact && record.note && <span className={styles.note}>{record.note}</span>}
      </div>
    </CardShell>
  );
}

interface WishlistCardProps {
  item: WishlistItem;
}

export function WishlistCard({ item }: WishlistCardProps): JSX.Element {
  return (
    <CardShell variant="wishlist" label={item.title}>
      <div
        className={styles.emptyCover}
        role="img"
        aria-label="No cover — record not in the collection yet"
      >
        <EmptyRingIcon />
      </div>
      <div className={styles.meta}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.artist}>{item.artist}</span>
        <span className={styles.spec}>{item.pressing}</span>
      </div>
    </CardShell>
  );
}
