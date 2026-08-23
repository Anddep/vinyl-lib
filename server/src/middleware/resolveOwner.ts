import type { Request, Response } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { prisma } from '../prisma/client';

/**
 * Turns `/u/:slug` into an owner, or answers 404.
 *
 * Unknown, private and suspended all give the same 404 with the same body. A
 * 403 would confirm that the slug is taken and someone is hiding behind it,
 * which is exactly what the private switch exists to prevent, and it would let
 * a caller enumerate which slugs are in use.
 *
 * The missing row is checked on its own line rather than folded into the
 * `hidden` test below: a signed-out visitor has no `session.userId`, so
 * `owner?.id !== req.session.userId` compares undefined against undefined,
 * finds them equal, and lets an unknown slug through to a null dereference.
 */
export const resolveOwnerFromSlug = asyncHandler(async (req: Request, res: Response, next) => {
  const owner = await prisma.user.findUnique({ where: { slug: String(req.params.slug) } });
  if (owner === null) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // The owner viewing their own private collection gets through, so "View site"
  // works without flipping the switch back.
  const hidden = owner.suspendedAt !== null || !owner.isPublic;
  if (hidden && owner.id !== req.session.userId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.locals.ownerId = owner.id;
  res.locals.owner = owner;
  next();
});
