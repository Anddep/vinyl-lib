import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../lib/asyncHandler';

export const statsRouter = Router();

interface TopValue {
  name: string;
  count: number;
}

/**
 * Most common genre, with its count.
 *
 * Ties break alphabetically. Without a second sort key Postgres is free to
 * return either row, so a genuine tie would make the stat card flip between
 * identical requests.
 *
 * genre and label are queried separately rather than through one helper taking
 * a field name: Prisma's generated types key off the literal column, so a
 * computed `[field]` loses all type safety.
 */
async function topGenre(): Promise<TopValue | null> {
  const [top] = await prisma.record.groupBy({
    by: ['genre'],
    _count: { _all: true },
    orderBy: [{ _count: { genre: 'desc' } }, { genre: 'asc' }],
    take: 1,
  });

  return top ? { name: top.genre, count: top._count._all } : null;
}

/** Most represented artist, with their record count. Ties break alphabetically. */
async function topArtist(): Promise<TopValue | null> {
  const [top] = await prisma.record.groupBy({
    by: ['artist'],
    _count: { _all: true },
    orderBy: [{ _count: { artist: 'desc' } }, { artist: 'asc' }],
    take: 1,
  });

  return top ? { name: top.artist, count: top._count._all } : null;
}

statsRouter.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalRecords, genre, artist, collectingSince, addedLast30Days] = await Promise.all([
      prisma.record.count(),
      topGenre(),
      topArtist(),
      prisma.siteSetting.findUnique({ where: { key: 'collectingSince' } }),
      prisma.record.count({ where: { addedAt: { gte: thirtyDaysAgo } } }),
    ]);

    res.json({
      totalRecords,
      topGenre: genre,
      topArtist: artist,
      // Deliberately read, not derived: MIN(addedAt) is when a row was
      // entered, not when the collection started.
      collectingSince: collectingSince?.value ?? null,
      addedLast30Days,
    });
  }),
);
