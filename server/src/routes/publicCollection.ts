import { Router, type Request, type Response } from 'express';
import type { User } from '@prisma/client';
import { resolveOwnerFromSlug } from '../middleware/resolveOwner';
import { recordsRouters } from './records';
import { settingsRouters } from './settings';
import { setupRouters } from './setup';
import { statsRouters } from './stats';
import { wishlistRouters } from './wishlist';

/**
 * Everything a visitor can read about one collection.
 *
 * mergeParams so `:slug` from the mount reaches the resolver. Every router
 * below it is the same `read` router the own tree uses — one set of handlers,
 * two ways of deciding whose data they are about.
 */
export const publicCollectionRouter = Router({ mergeParams: true });

publicCollectionRouter.use(resolveOwnerFromSlug);

publicCollectionRouter.get('/', (_req: Request, res: Response) => {
  const owner = res.locals.owner as User;
  // Slug, name and avatar only: nothing else is needed to render the page, and
  // the email in particular is not the visitor's business.
  res.json({ slug: owner.slug, displayName: owner.displayName, avatarUrl: owner.avatarUrl });
});

publicCollectionRouter.use(recordsRouters.read);
publicCollectionRouter.use(statsRouters.read);
publicCollectionRouter.use(wishlistRouters.read);
publicCollectionRouter.use(setupRouters.read);
publicCollectionRouter.use(settingsRouters.read);
