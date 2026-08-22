import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../lib/asyncHandler';
import { parseId } from '../lib/params';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { wishlistCreateSchema, wishlistUpdateSchema } from '../schemas/content';

export const wishlistRouter = Router();

wishlistRouter.get(
  '/wishlist',
  asyncHandler(async (_req: Request, res: Response) => {
    // position then id: equal positions fall back to insertion order rather
    // than whatever the query planner happens to return.
    const items = await prisma.wishlistItem.findMany({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    res.json(items);
  }),
);

wishlistRouter.post(
  '/wishlist',
  requireAuth,
  validate(wishlistCreateSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const created = await prisma.wishlistItem.create({ data: res.locals.body });
    res.status(201).json(created);
  }),
);

wishlistRouter.patch(
  '/wishlist/:id',
  requireAuth,
  validate(wishlistUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid Wishlist item id' });
      return;
    }

    if (!(await prisma.wishlistItem.findUnique({ where: { id } }))) {
      res.status(404).json({ error: 'Wishlist item not found' });
      return;
    }

    res.json(await prisma.wishlistItem.update({ where: { id }, data: res.locals.body }));
  }),
);

wishlistRouter.delete(
  '/wishlist/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid Wishlist item id' });
      return;
    }

    if (!(await prisma.wishlistItem.findUnique({ where: { id } }))) {
      res.status(404).json({ error: 'Wishlist item not found' });
      return;
    }

    await prisma.wishlistItem.delete({ where: { id } });
    res.status(204).end();
  }),
);
