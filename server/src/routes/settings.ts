import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { settingsSchema } from '../schemas/content';

export const settingsRouter = Router();

settingsRouter.get(
  '/settings',
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await prisma.siteSetting.findMany();
    res.json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  }),
);

settingsRouter.patch(
  '/settings',
  requireAuth,
  validate(settingsSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const body = res.locals.body as Record<string, string>;

    for (const [key, value] of Object.entries(body)) {
      await prisma.siteSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }

    const rows = await prisma.siteSetting.findMany();
    res.json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  }),
);
