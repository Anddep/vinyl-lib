import { limits } from '../config/env';
import { prisma } from '../prisma/client';
import { createResourceRouter } from '../lib/resourceRouter';
import { wishlistCreateSchema, wishlistUpdateSchema } from '../schemas/content';

export const wishlistRouters = createResourceRouter({
  path: 'wishlist',
  noun: 'Wishlist item',
  delegate: prisma.wishlistItem,
  createSchema: wishlistCreateSchema,
  max: () => limits().maxWishlist,
  plural: 'wishlist items',
  updateSchema: wishlistUpdateSchema,
});
