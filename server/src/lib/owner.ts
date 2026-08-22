import type { Response } from 'express';

/**
 * The owner every handler works against.
 *
 * Set by `requireUser` (from the session) or `resolveOwnerFromSlug` (from the
 * URL), and by nothing else — in particular never from a request body. The
 * throw is unreachable through a mounted route: both middlewares either set it
 * or answer the request themselves, so reaching here means a router was mounted
 * without an owner resolver, which is a wiring bug rather than a bad request.
 */
export function ownerOf(res: Response): number {
  const ownerId: unknown = res.locals.ownerId;
  if (typeof ownerId !== 'number') {
    throw new Error('ownerId missing: this router was mounted without an owner resolver');
  }
  return ownerId;
}
