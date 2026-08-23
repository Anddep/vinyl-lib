import { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { ownerOf } from '../lib/owner';
import { requireUser } from '../middleware/requireUser';
import { validate } from '../middleware/validate';
import { prisma } from '../prisma/client';
import { accountUpdateSchema } from '../schemas/account';

export const accountRouter = Router();

accountRouter.patch(
  '/account',
  requireUser,
  validate(accountUpdateSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const id = ownerOf(res);
    const data = res.locals.body as Prisma.UserUpdateInput;

    try {
      const user = await prisma.user.update({ where: { id }, data });
      res.json({
        id: user.id,
        slug: user.slug,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isPublic: user.isPublic,
      });
    } catch (error) {
      // Let the unique index decide rather than checking first: a pre-check
      // would still race, and this way there is one source of truth.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Shaped like a validation failure so the account form renders it
        // against the field, the same way every other admin form does.
        res
          .status(409)
          .json({ error: 'Validation failed', fields: { slug: 'That address is taken' } });
        return;
      }
      throw error;
    }
  }),
);
