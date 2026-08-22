import type { CSSProperties } from 'react';
import styles from './VinylDisc.module.css';

interface VinylDiscProps {
  /** Default diameter in px; a consumer stylesheet can override via --disc-size. */
  size: number;
  spin?: boolean;
  className?: string;
}

export function VinylDisc({ size, spin = true, className }: VinylDiscProps): JSX.Element {
  const classes = [styles.disc, spin ? styles.spin : null, className].filter(Boolean).join(' ');
  const style = { '--disc-size-default': `${size}px` } as CSSProperties;

  return <div className={classes} style={style} aria-hidden="true" />;
}
