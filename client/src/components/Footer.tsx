import { DiscIcon, SocialPlayIcon, SocialRingsIcon, SocialSquareIcon } from './ui/icons';
import styles from './Footer.module.css';

const FOOTER_LINKS = [
  { href: '#top', label: 'Home' },
  { href: '#featured', label: 'Collection' },
  { href: '#setup', label: 'Setup' },
  { href: '#contact', label: 'Contact' },
];

/**
 * Placeholder social targets — the collector has not supplied profile URLs, so
 * these point at the contact section rather than at dead external links.
 */
const SOCIALS = [
  { label: 'Discogs', Icon: SocialSquareIcon },
  { label: 'Instagram', Icon: SocialRingsIcon },
  { label: 'YouTube', Icon: SocialPlayIcon },
];

export function Footer(): JSX.Element {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <a className={styles.brand} href="#top">
          <DiscIcon size={22} />
          <span className={styles.wordmark}>Grooves &amp; Dust</span>
        </a>

        <nav className={styles.links} aria-label="Footer">
          {FOOTER_LINKS.map((link) => (
            <a key={link.href} className={styles.link} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className={styles.socials}>
          {SOCIALS.map(({ label, Icon }) => (
            <a key={label} className={styles.social} href="#contact" aria-label={label}>
              <Icon />
            </a>
          ))}
        </div>

        <span className={styles.copyright}>
          © 2026 Grooves &amp; Dust · Built with React + Node.js
        </span>
      </div>
    </footer>
  );
}
