import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getAuthStatus } from '../api/client';
import { useResource } from '../hooks/useResource';

/**
 * Gate for the admin tree.
 *
 * Renders nothing while the session check is in flight: showing the shell
 * first would flash protected chrome to someone who is not signed in. A failed
 * check counts as unauthenticated — the safe direction to fail.
 */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element | null {
  const location = useLocation();
  const { data, error, loading } = useResource(getAuthStatus);

  if (loading) {
    return null;
  }

  if (error || !data?.authenticated) {
    // `state.from` lets the login screen return the user where they aimed.
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
