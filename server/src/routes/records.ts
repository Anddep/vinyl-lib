import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { parseLimit } from '../lib/query';
import { asyncHandler } from '../lib/asyncHandler';
import { limits } from '../config/env';
import { ownerOf } from '../lib/owner';
import { enforceCeiling } from '../lib/quota';
import { parseId } from '../lib/params';
import { slugify, uniqueSlug } from '../lib/slug';
import type { ResourceRouters } from '../lib/resourceRouter';
import { requireUser } from '../middleware/requireUser';
import { validate } from '../middleware/validate';
import { recordCreateSchema, recordUpdateSchema, type RecordCreate } from '../schemas/record';

const DEFAULT_LIMIT = 100;

const list = asyncHandler(async (req: Request, res: Response) => {
  const ownerId = ownerOf(res);
  const limit = parseLimit(req.query.limit, DEFAULT_LIMIT);
  const byAddedAt = req.query.sort === 'addedAt';

  const records = await prisma.record.findMany({
    where: { ownerId },
    orderBy: byAddedAt ? [{ addedAt: 'desc' }] : [{ position: 'asc' }, { id: 'asc' }],
    take: limit,
  });

  // The "New" badge is derived, never stored: exactly one record per
  // collection carries it, the most recently added one. Scoped to the owner,
  // or with two collectors only one collection would ever show a badge.
  const newest = await prisma.record.findFirst({
    where: { ownerId },
    orderBy: { addedAt: 'desc' },
  });

  res.json(records.map((record) => ({ ...record, isNew: record.id === newest?.id })));
});

/**
 * Every genre actually present in this collection, alphabetically.
 *
 * The filter chips are built from this rather than a hardcoded list, so a genre
 * the collector invents appears without a code change, and one no record uses
 * stops offering an always-empty filter.
 */
const genres = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await prisma.record.groupBy({
    by: ['genre'],
    where: { ownerId: ownerOf(res) },
    _count: { _all: true },
    orderBy: { genre: 'asc' },
  });

  res.json(rows.map((row) => ({ name: row.genre, count: row._count._all })));
});

const readOne = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Invalid record id' });
    return;
  }

  const record = await prisma.record.findFirst({ where: { id, ownerId: ownerOf(res) } });
  if (!record) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }

  res.json(record);
});

async function findOwned(id: number, ownerId: number) {
  return prisma.record.findFirst({ where: { id, ownerId } });
}

function buildRouters(): ResourceRouters {
  const read = Router();
  read.get('/records', list);
  read.get('/genres', genres);
  read.get('/records/:id', readOne);

  const own = Router();
  own.get('/records', requireUser, list);
  own.get('/genres', requireUser, genres);
  own.get('/records/:id', requireUser, readOne);

  own.post(
    '/records',
    requireUser,
    validate(recordCreateSchema),
    asyncHandler(async (_req: Request, res: Response) => {
      const ownerId = ownerOf(res);
      const allowed = enforceCeiling(res, {
        count: await prisma.record.count({ where: { ownerId } }),
        max: limits().maxRecords,
        noun: 'records',
      });
      if (!allowed) {
        return;
      }

      const body = res.locals.body as RecordCreate;

      // The owner is part of the collision check: without it the second
      // collector to add Kind of Blue gets kind-of-blue-2 for no visible reason.
      const slug = await uniqueSlug(
        body.slug ?? slugify(body.title),
        async (candidate) =>
          (await prisma.record.count({ where: { ownerId, slug: candidate } })) > 0,
      );

      res.status(201).json(await prisma.record.create({ data: { ...body, slug, ownerId } }));
    }),
  );

  own.patch(
    '/records/:id',
    requireUser,
    validate(recordUpdateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ownerId = ownerOf(res);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid record id' });
        return;
      }
      if (!(await findOwned(id, ownerId))) {
        res.status(404).json({ error: 'Record not found' });
        return;
      }

      res.json(await prisma.record.update({ where: { id, ownerId }, data: res.locals.body }));
    }),
  );

  own.delete(
    '/records/:id',
    requireUser,
    asyncHandler(async (req: Request, res: Response) => {
      const ownerId = ownerOf(res);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid record id' });
        return;
      }
      if (!(await findOwned(id, ownerId))) {
        res.status(404).json({ error: 'Record not found' });
        return;
      }

      await prisma.record.delete({ where: { id, ownerId } });
      res.status(204).end();
    }),
  );

  return { read, own };
}

export const recordsRouters = buildRouters();
