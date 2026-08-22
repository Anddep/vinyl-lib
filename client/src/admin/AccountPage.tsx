import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, updateAccount } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/Button';
import styles from './components/ResourceScreen.module.css';

export default function AccountPage(): JSX.Element {
  const { user, refresh } = useAuth();
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setSlug(user.slug);
      setDisplayName(user.displayName);
      setIsPublic(user.isPublic);
    }
  }, [user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setStatus(null);

    try {
      await updateAccount({ slug, displayName, isPublic });
      // The chrome and the guard read the same context, so one refresh updates
      // the sidebar name and the "View site" link together.
      refresh();
      setStatus('Saved.');
    } catch (caught) {
      // A 409 arrives shaped like a validation failure precisely so it can land
      // on the field rather than as an opaque banner.
      if (caught instanceof ApiError && Object.keys(caught.fields).length > 0) {
        setFieldErrors(caught.fields);
      } else {
        setStatus('Could not save that.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.heading}>Profile</h1>
        <p className={styles.sub}>Who you are, and who can see your collection.</p>
      </div>

      <form className={styles.page} onSubmit={handleSubmit} noValidate>
        <section className={styles.panel}>
          <div className={styles.grid}>
            <div
              className={[styles.field, fieldErrors.displayName ? styles.invalid : null]
                .filter(Boolean)
                .join(' ')}
            >
              <label className={styles.label} htmlFor="account-name">
                Display name
              </label>
              <input
                id="account-name"
                className={styles.control}
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              {fieldErrors.displayName && (
                <span className={styles.error} role="alert">
                  {fieldErrors.displayName}
                </span>
              )}
            </div>

            <div
              className={[styles.field, fieldErrors.slug ? styles.invalid : null]
                .filter(Boolean)
                .join(' ')}
            >
              <label className={styles.label} htmlFor="account-slug">
                Address
              </label>
              <input
                id="account-slug"
                className={styles.control}
                type="text"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
              <span className={styles.sub}>
                Your collection lives at /u/{slug || 'your-address'}. Changing this frees the old
                one straight away and breaks links you have already shared.
              </span>
              {fieldErrors.slug && (
                <span className={styles.error} role="alert">
                  {fieldErrors.slug}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelHeading}>Visibility</h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="account-public">
              <input
                id="account-public"
                type="checkbox"
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
              />{' '}
              Visible to anyone with the link
            </label>
            <span className={styles.sub}>
              When this is off your collection returns a not-found page to everyone but you — the
              same page an address nobody has taken returns, so nobody can tell the difference.
            </span>
          </div>
        </section>

        <div className={styles.actions}>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {status && (
            <p className={styles.message} role="status">
              {status}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
