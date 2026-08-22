import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, login } from '../api/client';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { DiscIcon } from '../components/ui/icons';
import styles from './LoginPage.module.css';

interface LocationState {
  from?: string;
}

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (password.length === 0) {
      setError('Enter your password.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await login(password);
      // Return the user to whatever they originally aimed at.
      const from = (location.state as LocationState | null)?.from;
      navigate(from ?? '/admin', { replace: true });
    } catch (caught) {
      // A 429 from the rate limiter needs its own message: "incorrect
      // password" would send the collector hunting for a typo that isn't there.
      if (caught instanceof ApiError && caught.status === 429) {
        setError(caught.message);
      } else {
        setError('Incorrect password.');
      }
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <DiscIcon size={26} />
          <span className={styles.wordmark}>Grooves &amp; Dust</span>
        </div>
        <h1 className={styles.heading}>Sign in to the admin</h1>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Field
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
          />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
