import type { ReactNode } from 'react';
import type { VinylRecord, WishlistItem } from '../types/collection';
import { ImagePlaceholder } from './ui/ImagePlaceholder';
import { EmptyRingIcon } from './ui/icons';
import styles from './AlbumCard.module.css';

/** Formats the mono spec line: "1970 · 2×LP · JAZZ". */
function specLine(record: VinylRecord): string {
  return `${record.year} · ${record.format} · ${record.genre.toUpperCase()}`;
}

/**
 * "Added 18 Aug". Formatted from the ISO date the API returns rather than
 * stored, so it cannot go stale against addedAt.
 */
function addedLabel(addedAt: string | undefined): string {
  if (!addedAt) {
    return '';
  }
  const date = new Date(addedAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  // UTC so the label does not shift a day either side of midnight.
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `Added ${day} ${month}`;
}

interface CardShellProps {
  href?: string | null;
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
      <a
        className={classes}
        href={href}
        // The target is an arbitrary URL the collector pasted: noopener stops
        // the opened page reaching back through window.opener.
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
      >
        {children}
      </a>
    );
  }

  return <article className={classes}>{children}</article>;
}

interface AlbumCardProps {
  record: VinylRecord;
  variant?: 'default' | 'compact';
}

export function AlbumCard({ record, variant = 'default' }: AlbumCardProps): JSX.Element {
  const isCompact = variant === 'compact';

  return (
    <CardShell href={record.url} variant={variant} label={`${record.title} by ${record.artist}`}>
      <ImagePlaceholder
        ratio="1"
        variant="cover"
        caption="cover 300×300"
        src={record.coverUrl}
        alt={`${record.title} cover`}
        className={styles.cover}
      >
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
        <span className={styles.spec}>
          {isCompact ? addedLabel(record.addedAt) : specLine(record)}
        </span>
      </div>
    </CardShell>
  );
}

interface WishlistCardProps {
  item: WishlistItem;
}

export function WishlistCard({ item }: WishlistCardProps): JSX.Element {
  return (
    <CardShell href={item.url} variant="wishlist" label={item.title}>
      {item.coverUrl ? (
        <ImagePlaceholder
          ratio="1"
          variant="cover"
          caption="cover 300×300"
          src={item.coverUrl}
          alt={`${item.title} cover`}
          className={styles.cover}
        />
      ) : (
        // No cover yet: the dashed empty slot reads as "not here", which is
        // the whole point of the wishlist.
        <div
          className={styles.emptyCover}
          role="img"
          aria-label="No cover — record not in the collection yet"
        >
          <EmptyRingIcon />
        </div>
      )}
      <div className={styles.meta}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.artist}>{item.artist}</span>
      </div>
    </CardShell>
  );
}
