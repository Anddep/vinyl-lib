import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { logout } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/Button';
import { DiscIcon } from '../components/ui/icons';
import styles from './AdminLayout.module.css';

const SECTIONS = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/records', label: 'Records', end: false },
  { to: '/admin/wishlist', label: 'Wishlist', end: false },
  { to: '/admin/setup', label: 'Setup', end: false },
  { to: '/admin/settings', label: 'Site content', end: false },
  { to: '/admin/account', label: 'Profile', end: false },
];

export default function AdminLayout(): JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Until /auth/me answers, '/' is the safe target: it redirects a signed-in
  // owner to their own collection anyway.
  const siteHref = user ? `/u/${user.slug}` : '/';

  async function handleLogout(): Promise<void> {
    await logout().catch(() => undefined);
    navigate('/', { replace: true });
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="Admin sections">
        <a className={styles.brand} href={siteHref}>
          <DiscIcon size={22} />
          <span className={styles.wordmark}>Grooves &amp; Dust</span>
        </a>

        {SECTIONS.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            end={section.end}
            className={({ isActive }) =>
              [styles.navLink, isActive ? styles.active : null].filter(Boolean).join(' ')
            }
          >
            {section.label}
          </NavLink>
        ))}

        <span className={styles.spacer} />

        <div className={styles.footer}>
          {user && <span className={styles.who}>{user.displayName}</span>}
          <a className={styles.viewSite} href={siteHref}>
            View site →
          </a>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </nav>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
