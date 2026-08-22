import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../lib/asyncHandler';
import { parseId } from '../lib/params';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { setupCreateSchema, setupUpdateSchema } from '../schemas/content';

export const setupRouter = Router();

setupRouter.get(
  '/setup',
  asyncHandler(async (_req: Request, res: Response) => {
    // position then id: equal positions fall back to insertion order rather
    // than whatever the query planner happens to return.
    const items = await prisma.setupItem.findMany({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    res.json(items);
  }),
);

setupRouter.post(
  '/setup',
  requireAuth,
  validate(setupCreateSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const created = await prisma.setupItem.create({ data: res.locals.body });
    res.status(201).json(created);
  }),
);

setupRouter.patch(
  '/setup/:id',
  requireAuth,
  validate(setupUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid Setup item id' });
      return;
    }

    if (!(await prisma.setupItem.findUnique({ where: { id } }))) {
      res.status(404).json({ error: 'Setup item not found' });
      return;
    }

    res.json(await prisma.setupItem.update({ where: { id }, data: res.locals.body }));
  }),
);

setupRouter.delete(
  '/setup/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid Setup item id' });
      return;
    }

    if (!(await prisma.setupItem.findUnique({ where: { id } }))) {
      res.status(404).json({ error: 'Setup item not found' });
      return;
    }

    await prisma.setupItem.delete({ where: { id } });
    res.status(204).end();
  }),
);
