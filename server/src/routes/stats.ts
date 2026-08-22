import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../lib/asyncHandler';
import { ownerOf } from '../lib/owner';
import type { ResourceRouters } from '../lib/resourceRouter';
import { requireUser } from '../middleware/requireUser';

interface TopValue {
  name: string;
  count: number;
}

/**
 * Most common genre in one collection, with its count.
 *
 * Ties break alphabetically. Without a second sort key Postgres is free to
 * return either row, so a genuine tie would make the stat card flip between
 * identical requests.
 *
 * genre and artist are queried separately rather than through one helper taking
 * a field name: Prisma's generated types key off the literal column, so a
 * computed `[field]` loses all type safety.
 */
async function topGenre(ownerId: number): Promise<TopValue | null> {
  const [top] = await prisma.record.groupBy({
    by: ['genre'],
    where: { ownerId },
    _count: { _all: true },
    orderBy: [{ _count: { genre: 'desc' } }, { genre: 'asc' }],
    take: 1,
  });

  return top ? { name: top.genre, count: top._count._all } : null;
}

/** Most represented artist, with their record count. Ties break alphabetically. */
async function topArtist(ownerId: number): Promise<TopValue | null> {
  const [top] = await prisma.record.groupBy({
    by: ['artist'],
    where: { ownerId },
    _count: { _all: true },
    orderBy: [{ _count: { artist: 'desc' } }, { artist: 'asc' }],
    take: 1,
  });

  return top ? { name: top.artist, count: top._count._all } : null;
}

const stats = asyncHandler(async (_req: Request, res: Response) => {
  const ownerId = ownerOf(res);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalRecords, genre, artist, collectingSince, addedLast30Days] = await Promise.all([
    prisma.record.count({ where: { ownerId } }),
    topGenre(ownerId),
    topArtist(ownerId),
    prisma.siteSetting.findUnique({
      where: { ownerId_key: { ownerId, key: 'collectingSince' } },
    }),
    prisma.record.count({ where: { ownerId, addedAt: { gte: thirtyDaysAgo } } }),
  ]);

  res.json({
    totalRecords,
    topGenre: genre,
    topArtist: artist,
    // Deliberately read, not derived: MIN(addedAt) is when a row was entered,
    // not when the collection started.
    collectingSince: collectingSince?.value ?? null,
    addedLast30Days,
  });
});

function buildRouters(): ResourceRouters {
  const read = Router();
  read.get('/stats', stats);

  const own = Router();
  own.get('/stats', requireUser, stats);

  return { read, own };
}

export const statsRouters = buildRouters();
