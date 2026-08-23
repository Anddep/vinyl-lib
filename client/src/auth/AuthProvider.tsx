import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getAuthStatus, type AuthUser } from '../api/client';
import { useResource } from '../hooks/useResource';

interface AuthState {
  user: AuthUser | null;
  /** True only for the first check. A refresh keeps the current answer on screen. */
  loading: boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * One answer to "who am I", shared by the landing page, the admin guard and the
 * account screen — which would otherwise ask three times on one page load.
 *
 * A failed check counts as signed out. That is the safe direction: the worst
 * case is being asked to sign in again, where the other direction would render
 * protected chrome to someone who may not be.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const { data, loading, refresh } = useResource(getAuthStatus);

  const value = useMemo<AuthState>(
    () => ({ user: data?.user ?? null, loading, refresh }),
    [data, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === null) {
    // Loud on purpose: without it a missing provider renders as a permanently
    // signed-out app, which looks like a login bug rather than a wiring one.
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return value;
}
