import { Router, type Request, type Response } from 'express';
import type { ZodType } from 'zod';
import { asyncHandler } from './asyncHandler';
import { ownerOf } from './owner';
import { parseId } from './params';
import { requireUser } from '../middleware/requireUser';
import { validate } from '../middleware/validate';

/** Body already parsed and stripped by the zod schema. */
type ValidatedBody = Record<string, unknown>;

/** Every query this factory makes is filtered by owner. The type says so. */
type OwnerScope = { ownerId: number };

/**
 * The slice of a Prisma model delegate this router needs.
 *
 * Declared structurally rather than importing Prisma's generated delegate
 * types: those are deeply generic and would drag the whole payload machinery
 * through a factory that only ever needs five calls.
 *
 * The important part is that `OwnerScope` is intersected into every `where`.
 * An unscoped read, update or delete does not typecheck, so a future resource
 * cannot forget the ownership check the way it could if this were a separate
 * lookup the route had to remember to call.
 *
 * `create` is the exception, and deliberately so: Prisma's generated create
 * input is a union of the checked form (`owner: { connect }`) and the unchecked
 * form (`ownerId`), and only the second has an ownerId — so intersecting
 * OwnerScope here makes every real delegate unassignable. The owner is instead
 * stamped one line below, inside this factory, where no caller can reach it and
 * nothing can forget it. `ownership.test.ts` asserts it.
 */
interface CrudDelegate {
  findMany(args: {
    where: OwnerScope;
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
  }): Promise<unknown[]>;
  // findFirst rather than findUnique: { id, ownerId } is not a unique input,
  // and findFirst says that plainly.
  findFirst(args: { where: OwnerScope & { id: number } }): Promise<unknown | null>;
  create(args: { data: ValidatedBody }): Promise<unknown>;
  update(args: { where: OwnerScope & { id: number }; data: ValidatedBody }): Promise<unknown>;
  delete(args: { where: OwnerScope & { id: number } }): Promise<unknown>;
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

export interface ResourceRouters {
  /**
   * GET only, no auth. The owner comes from `res.locals`, which the mount is
   * responsible for setting — see the /api/u/:slug tree.
   */
  read: Router;
  /** GET plus writes, every route behind requireUser. Mounted under /api. */
  own: Router;
}

/**
 * List, create, update and delete for a position-ordered content resource,
 * scoped to one owner.
 */
export function createResourceRouter({
  path,
  noun,
  delegate,
  createSchema,
  updateSchema,
}: ResourceRouterOptions): ResourceRouters {
  /** Resolves the :id param, answering 400 or 404 itself when it cannot. */
  async function resolveId(req: Request, res: Response): Promise<number | null> {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: `Invalid ${noun.toLowerCase()} id` });
      return null;
    }
    // A row that does not exist and a row belonging to someone else are the
    // same answer. Distinguishing them would let a caller enumerate ids.
    if (!(await delegate.findFirst({ where: { id, ownerId: ownerOf(res) } }))) {
      res.status(404).json({ error: `${noun} not found` });
      return null;
    }
    return id;
  }

  const list = asyncHandler(async (_req: Request, res: Response) => {
    // position then id: equal positions fall back to insertion order rather
    // than whatever the query planner happens to return.
    res.json(
      await delegate.findMany({
        where: { ownerId: ownerOf(res) },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  const read = Router();
  read.get(`/${path}`, list);

  const own = Router();
  // requireUser sits on each route rather than on the router, so an unmatched
  // path under /api still reaches the 404 handler instead of answering 401.
  own.get(`/${path}`, requireUser, list);

  own.post(
    `/${path}`,
    requireUser,
    validate(createSchema),
    asyncHandler(async (_req: Request, res: Response) => {
      // ownerId last, so a body key of that name cannot win. The zod schemas
      // strip unknown keys as well, which makes this the second line of defence.
      const data = { ...(res.locals.body as ValidatedBody), ownerId: ownerOf(res) };
      res.status(201).json(await delegate.create({ data }));
    }),
  );

  own.patch(
    `/${path}/:id`,
    requireUser,
    validate(updateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const id = await resolveId(req, res);
      if (id === null) {
        return;
      }
      res.json(
        await delegate.update({
          where: { id, ownerId: ownerOf(res) },
          data: res.locals.body as ValidatedBody,
        }),
      );
    }),
  );

  own.delete(
    `/${path}/:id`,
    requireUser,
    asyncHandler(async (req: Request, res: Response) => {
      const id = await resolveId(req, res);
      if (id === null) {
        return;
      }
      await delegate.delete({ where: { id, ownerId: ownerOf(res) } });
      res.status(204).end();
    }),
  );

  return { read, own };
}
