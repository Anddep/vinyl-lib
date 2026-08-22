import { useId, useState } from 'react';
import { DiscIcon } from './ui/icons';
import styles from './NavBar.module.css';

const NAV_LINKS = [
  { href: '#top', label: 'Home', active: true },
  { href: '#collection', label: 'Collection', active: false },
  { href: '#setup', label: 'Setup', active: false },
];

export function NavBar(): JSX.Element {
  const panelId = useId();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className={styles.nav} aria-label="Primary">
      <div className={styles.inner}>
        <a className={styles.brand} href="#top">
          <DiscIcon size={26} />
          <span className={styles.wordmark}>Grooves &amp; Dust</span>
        </a>

        <div className={styles.links}>
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              className={[styles.link, link.active ? styles.active : null]
                .filter(Boolean)
                .join(' ')}
              href={link.href}
              aria-current={link.active ? 'page' : undefined}
            >
              {link.label}
            </a>
          ))}
        </div>

        <button
          type="button"
          className={styles.toggle}
          aria-expanded={menuOpen}
          aria-controls={panelId}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className={styles.toggleBar} />
          <span className={styles.toggleBar} />
          <span className={styles.toggleBar} />
        </button>
      </div>

      <div
        id={panelId}
        className={[styles.panel, menuOpen ? styles.panelOpen : null].filter(Boolean).join(' ')}
      >
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            className={[styles.link, link.active ? styles.active : null].filter(Boolean).join(' ')}
            href={link.href}
            aria-current={link.active ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
