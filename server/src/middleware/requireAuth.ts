import type { NextFunction, Request, Response } from 'express';

/** Gate for every write route. There are no public writes. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.isAdmin === true) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required' });
}
