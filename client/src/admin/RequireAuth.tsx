import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

/**
 * Gate for the admin tree.
 *
 * Renders nothing while the session check is in flight: showing the shell first
 * would flash protected chrome to someone who is not signed in.
 */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element | null {
  const location = useLocation();
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user) {
    // `state.from` lets the landing page return them where they aimed.
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
