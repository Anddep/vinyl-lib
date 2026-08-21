import type { CSSProperties, ReactNode } from 'react';
import styles from './ImagePlaceholder.module.css';

interface ImagePlaceholderProps {
  /** CSS aspect-ratio value, e.g. "4 / 5" or "1". */
  ratio: string;
  /** Describes the intended shot and its export size. */
  caption: string;
  variant?: 'photo' | 'cover';
  className?: string;
  children?: ReactNode;
}

export function ImagePlaceholder({
  ratio,
  caption,
  variant = 'photo',
  className,
  children,
}: ImagePlaceholderProps): JSX.Element {
  const classes = [styles.placeholder, styles[variant], className].filter(Boolean).join(' ');
  const style = { aspectRatio: ratio } as CSSProperties;

  return (
    <div className={classes} style={style} role="img" aria-label={caption}>
      <span
        className={variant === 'cover' ? styles.coverCaption : styles.photoCaption}
        aria-hidden="true"
      >
        {caption}
      </span>
      {children}
    </div>
  );
}
