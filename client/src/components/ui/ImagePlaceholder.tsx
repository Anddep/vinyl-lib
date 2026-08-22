import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import styles from './ImagePlaceholder.module.css';

interface ImagePlaceholderProps {
  /** CSS aspect-ratio value, e.g. "4 / 5" or "1". */
  ratio: string;
  /** Describes the intended shot and its export size. */
  caption: string;
  variant?: 'photo' | 'cover';
  /** Real image to show in the slot. Falls back to the stripes when absent. */
  src?: string | null;
  alt?: string;
  className?: string;
  children?: ReactNode;
}

export function ImagePlaceholder({
  ratio,
  caption,
  variant = 'photo',
  src,
  alt,
  className,
  children,
}: ImagePlaceholderProps): JSX.Element {
  // An external cover URL is not under our control, so a dead host degrades to
  // the designed placeholder rather than a broken-image icon.
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  const classes = [styles.placeholder, styles[variant], className].filter(Boolean).join(' ');
  const style = { aspectRatio: ratio } as CSSProperties;

  return (
    <div
      className={classes}
      style={style}
      // Only label the wrapper when it *is* the image; otherwise the real
      // <img> inside carries the accessible name.
      role={showImage ? undefined : 'img'}
      aria-label={showImage ? undefined : caption}
    >
      {showImage ? (
        <img
          className={styles.image}
          src={src ?? undefined}
          alt={alt ?? caption}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className={variant === 'cover' ? styles.coverCaption : styles.photoCaption}
          aria-hidden="true"
        >
          {caption}
        </span>
      )}
      {children}
    </div>
  );
}
