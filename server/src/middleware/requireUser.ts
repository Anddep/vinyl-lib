import type { NextFunction, Request, Response } from 'express';

/**
 * Is anyone signed in — and, if so, whose data is this request about.
 *
 * Deliberately synchronous and deliberately not loading the user: checking
 * `suspendedAt` here would put a query on every authenticated request to catch
 * a state that changes twice a year. Suspension is enforced at sign-in, and the
 * operator's suspend recipe deletes that user's session rows, which revokes
 * them immediately.
 */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.session.userId;
  if (typeof userId !== 'number') {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  res.locals.ownerId = userId;
  next();
}
