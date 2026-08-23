import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Set only by a completed OAuth callback, after regenerate(). */
    userId?: number;
    /**
     * The in-flight handshake. Deleted on the first callback that reads it, so
     * a replayed callback finds nothing and fails state validation.
     */
    oauth?: {
      provider: string;
      state: string;
      verifier: string | null;
      returnTo: string | null;
      invite: string | null;
    };
  }
}
