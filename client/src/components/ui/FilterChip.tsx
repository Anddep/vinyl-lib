import styles from './FilterChip.module.css';

interface FilterChipProps {
  label: string;
  count?: number;
  selected?: boolean;
  disabled?: boolean;
  shape?: 'pill' | 'square';
  onToggle: () => void;
}

export function FilterChip({
  label,
  count,
  selected = false,
  disabled = false,
  shape = 'pill',
  onToggle,
}: FilterChipProps): JSX.Element {
  const classes = [
    styles.chip,
    styles[shape],
    selected ? styles.selected : null,
    count !== undefined ? styles.hasCount : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      // aria-pressed communicates the toggle state; the chips are filters, not
      // navigation, so a pressed button is the right role here.
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
    >
      {label}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
