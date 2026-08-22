import { Router, type Request, type Response } from 'express';
import type { ZodType } from 'zod';
import { asyncHandler } from './asyncHandler';
import { parseId } from './params';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';

/** Body already parsed and stripped by the zod schema. */
type ValidatedBody = Record<string, unknown>;

/**
 * The slice of a Prisma model delegate this router needs.
 *
 * Declared structurally rather than importing Prisma's generated delegate
 * types: those are deeply generic and would drag the whole payload machinery
 * through a factory whose four calls all key on `id`.
 */
interface CrudDelegate {
  findMany(args: { orderBy: Array<Record<string, 'asc' | 'desc'>> }): Promise<unknown[]>;
  findUnique(args: { where: { id: number } }): Promise<unknown | null>;
  // `data` is deliberately loose: the zod schema is what guarantees its shape,
  // and Prisma's generated input types cannot be expressed generically here.
  create(args: { data: ValidatedBody }): Promise<unknown>;
  update(args: { where: { id: number }; data: ValidatedBody }): Promise<unknown>;
  delete(args: { where: { id: number } }): Promise<unknown>;
}

interface ResourceRouterOptions {
  /** URL segment and the name used in error messages, e.g. "wishlist". */
  path: string;
  /** Singular noun for error messages, e.g. "Wishlist item". */
  noun: string;
  delegate: CrudDelegate;
  createSchema: ZodType;
  updateSchema: ZodType;
}

/**
 * List + create + update + delete for a position-ordered content resource.
 *
 * Wishlist and setup rows had byte-identical routers differing only in the
 * model, path and schemas — a fix to one had to be remembered for the other.
 * Records keep their own router: slug generation and the derived "new" flag
 * make them genuinely different.
 */
export function createResourceRouter({
  path,
  noun,
  delegate,
  createSchema,
  updateSchema,
}: ResourceRouterOptions): Router {
  const router = Router();

  /** Resolves the :id param, answering 400 or 404 itself when it cannot. */
  async function resolveId(req: Request, res: Response): Promise<number | null> {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: `Invalid ${noun.toLowerCase()} id` });
      return null;
    }
    if (!(await delegate.findUnique({ where: { id } }))) {
      res.status(404).json({ error: `${noun} not found` });
      return null;
    }
    return id;
  }

  router.get(
    `/${path}`,
    asyncHandler(async (_req: Request, res: Response) => {
      // position then id: equal positions fall back to insertion order rather
      // than whatever the query planner happens to return.
      res.json(await delegate.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] }));
    }),
  );

  router.post(
    `/${path}`,
    requireAuth,
    validate(createSchema),
    asyncHandler(async (_req: Request, res: Response) => {
      res.status(201).json(await delegate.create({ data: res.locals.body as ValidatedBody }));
    }),
  );

  router.patch(
    `/${path}/:id`,
    requireAuth,
    validate(updateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const id = await resolveId(req, res);
      if (id === null) {
        return;
      }
      res.json(await delegate.update({ where: { id }, data: res.locals.body as ValidatedBody }));
    }),
  );

  router.delete(
    `/${path}/:id`,
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const id = await resolveId(req, res);
      if (id === null) {
        return;
      }
      await delegate.delete({ where: { id } });
      res.status(204).end();
    }),
  );

  return router;
}
