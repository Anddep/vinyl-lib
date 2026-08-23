import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../lib/asyncHandler';
import { ownerOf } from '../lib/owner';
import type { ResourceRouters } from '../lib/resourceRouter';
import { requireUser } from '../middleware/requireUser';
import { validate } from '../middleware/validate';
import { settingsSchema } from '../schemas/content';

async function settingsFor(ownerId: number): Promise<Record<string, string>> {
  const rows = await prisma.siteSetting.findMany({ where: { ownerId } });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

const read = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await settingsFor(ownerOf(res)));
});

function buildRouters(): ResourceRouters {
  const readRouter = Router();
  readRouter.get('/settings', read);

  const own = Router();
  own.get('/settings', requireUser, read);

  own.patch(
    '/settings',
    requireUser,
    validate(settingsSchema),
    asyncHandler(async (_req: Request, res: Response) => {
      const ownerId = ownerOf(res);
      const body = res.locals.body as Record<string, string>;

      for (const [key, value] of Object.entries(body)) {
        await prisma.siteSetting.upsert({
          // key alone is no longer unique — it is one half of the primary key.
          where: { ownerId_key: { ownerId, key } },
          create: { ownerId, key, value },
          update: { value },
        });
      }

      res.json(await settingsFor(ownerId));
    }),
  );

  return { read: readRouter, own };
}

export const settingsRouters = buildRouters();
