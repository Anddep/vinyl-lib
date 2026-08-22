import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Replaces what SameSite=Strict was doing before the OAuth callback forced the
 * cookie to Lax.
 *
 * Lax already withholds the cookie from cross-site non-GET requests, so this is
 * the second layer rather than the first. A request with no Origin header at
 * all passes: curl and server-to-server callers send none, and they are not the
 * cross-site browser request this defends against.
 */
export function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (origin !== undefined && origin !== env.PUBLIC_BASE_URL) {
    res.status(403).json({ error: 'Cross-origin request rejected' });
    return;
  }

  next();
}
