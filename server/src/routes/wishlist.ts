import { prisma } from '../prisma/client';
import { createResourceRouter } from '../lib/resourceRouter';
import { wishlistCreateSchema, wishlistUpdateSchema } from '../schemas/content';

export const wishlistRouters = createResourceRouter({
  path: 'wishlist',
  noun: 'Wishlist item',
  delegate: prisma.wishlistItem,
  createSchema: wishlistCreateSchema,
  updateSchema: wishlistUpdateSchema,
});
