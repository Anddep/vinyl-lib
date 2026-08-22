import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { parseLimit } from '../lib/query';
import { asyncHandler } from '../lib/asyncHandler';
import { parseId } from '../lib/params';
import { slugify, uniqueSlug } from '../lib/slug';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { recordCreateSchema, recordUpdateSchema, type RecordCreate } from '../schemas/record';

export const recordsRouter = Router();

const DEFAULT_LIMIT = 100;

recordsRouter.get(
  '/records',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit, DEFAULT_LIMIT);
    const byAddedAt = req.query.sort === 'addedAt';

    const records = await prisma.record.findMany({
      orderBy: byAddedAt ? [{ addedAt: 'desc' }] : [{ position: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    // The "New" badge is derived, never stored: exactly one record carries it,
    // the most recently added in the whole table.
    const newest = await prisma.record.findFirst({ orderBy: { addedAt: 'desc' } });

    res.json(records.map((record) => ({ ...record, isNew: record.id === newest?.id })));
  }),
);

/**
 * Every genre actually present in the collection, alphabetically.
 *
 * The homepage filter is built from this rather than a hardcoded list, so a
 * genre the collector invents in the admin appears as a chip without a code
 * change, and a genre no record uses stops offering an always-empty filter.
 */
recordsRouter.get(
  '/genres',
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await prisma.record.groupBy({
      by: ['genre'],
      _count: { _all: true },
      orderBy: { genre: 'asc' },
    });

    res.json(rows.map((row) => ({ name: row.genre, count: row._count._all })));
  }),
);

recordsRouter.get(
  '/records/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid record id' });
      return;
    }

    const record = await prisma.record.findUnique({ where: { id } });
    if (!record) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }

    res.json(record);
  }),
);

recordsRouter.post(
  '/records',
  requireAuth,
  validate(recordCreateSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const body = res.locals.body as RecordCreate;

    const slug = await uniqueSlug(
      body.slug ?? slugify(body.title),
      async (candidate) => (await prisma.record.count({ where: { slug: candidate } })) > 0,
    );

    const created = await prisma.record.create({ data: { ...body, slug } });
    res.status(201).json(created);
  }),
);

recordsRouter.patch(
  '/records/:id',
  requireAuth,
  validate(recordUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid record id' });
      return;
    }

    if (!(await prisma.record.findUnique({ where: { id } }))) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }

    res.json(await prisma.record.update({ where: { id }, data: res.locals.body }));
  }),
);

recordsRouter.delete(
  '/records/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid record id' });
      return;
    }

    if (!(await prisma.record.findUnique({ where: { id } }))) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }

    await prisma.record.delete({ where: { id } });
    res.status(204).end();
  }),
);
