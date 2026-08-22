import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { getProviders } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { DiscIcon } from '../components/ui/icons';
import { useResource } from '../hooks/useResource';
import styles from './LandingPage.module.css';

/** Every `?error=` the OAuth callback can redirect back with. */
const MESSAGES: Record<string, string> = {
  state: 'That sign-in link expired. Try again.',
  denied: 'Sign-in was cancelled.',
  provider: 'That provider could not be reached. Try again in a moment.',
  session: 'Something went wrong starting your session. Try again.',
  email_unverified: 'We need a verified email address from your provider to sign you in.',
  suspended: 'This account has been suspended.',
  signup_closed: 'New accounts are closed at the moment.',
  invite_required: 'New accounts are invite only right now. You need an invite link to join.',
};

const LABELS: Record<string, string> = {
  google: 'Continue with Google',
  github: 'Continue with GitHub',
};

interface LocationState {
  from?: string;
}

export default function LandingPage(): JSX.Element | null {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const providers = useResource(getProviders);

  if (loading) {
    return null;
  }

  if (user) {
    return <Navigate to={`/u/${user.slug}`} replace />;
  }

  const error = params.get('error');
  const invite = params.get('invite');
  const from = (location.state as LocationState | null)?.from;

  /**
   * The invite code rides along untouched and is validated only at redemption.
   * There is no field and no "invalid code" message here: telling an anonymous
   * visitor whether a code exists would be a free oracle, and the link itself
   * is the invitation.
   */
  function hrefFor(provider: string): string {
    const query = new URLSearchParams();
    if (invite) {
      query.set('invite', invite);
    }
    if (from) {
      query.set('next', from);
    }
    const suffix = query.toString();
    return `/api/auth/${provider}${suffix ? `?${suffix}` : ''}`;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <DiscIcon size={26} />
          <span className={styles.wordmark}>Grooves &amp; Dust</span>
        </div>
        <h1 className={styles.heading}>Keep your records spinning</h1>
        <p className={styles.lede}>
          Catalogue your collection, and share it at an address of your own.
        </p>

        {error && (
          <p className={styles.error} role="alert">
            {MESSAGES[error] ?? 'Something went wrong signing you in. Try again.'}
          </p>
        )}

        <div className={styles.providers}>
          {(providers.data ?? []).map((provider) => (
            // A real anchor, not a fetch: the flow is a browser navigation, and
            // fetch cannot follow a cross-origin redirect that sets a cookie.
            <a key={provider} className={styles.provider} href={hrefFor(provider)}>
              {LABELS[provider] ?? `Continue with ${provider}`}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
