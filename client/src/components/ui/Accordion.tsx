import { useId, useState } from 'react';
import type { FaqItem } from '../../types/collection';
import styles from './Accordion.module.css';

interface AccordionProps {
  items: FaqItem[];
  /** Ids open on mount. The handoff opens the first question by default. */
  defaultOpenIds?: string[];
}

/**
 * Items open and close independently — this is a disclosure list, not an
 * exclusive accordion, so opening one never closes another.
 */
export function Accordion({ items, defaultOpenIds = [] }: AccordionProps): JSX.Element {
  const baseId = useId();
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(defaultOpenIds));

  function toggle(id: string): void {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className={styles.accordion}>
      {items.map((item) => {
        const isOpen = openIds.has(item.id);
        const panelId = `${baseId}-${item.id}`;
        const triggerId = `${panelId}-trigger`;

        return (
          <div
            key={item.id}
            className={[styles.item, isOpen ? styles.open : null].filter(Boolean).join(' ')}
          >
            <button
              type="button"
              id={triggerId}
              className={styles.trigger}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(item.id)}
            >
              <span className={styles.question}>{item.question}</span>
              <span className={styles.indicator} aria-hidden="true">
                {isOpen ? '−' : '+'}
              </span>
            </button>
            {isOpen && (
              <p className={styles.answer} id={panelId} role="region" aria-labelledby={triggerId}>
                {item.answer}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
