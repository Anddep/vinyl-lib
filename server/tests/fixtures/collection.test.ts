import { beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from './collection';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('collection fixture', () => {
  it('loads the handoff content', async () => {
    await loadFixture(prisma);

    // 14, not 20: the handoff's featured and recent lists are disjoint albums.
    expect(await prisma.record.count()).toBe(14);
    expect(await prisma.wishlistItem.count()).toBe(6);
    expect(await prisma.setupItem.count()).toBe(5);

    const setting = await prisma.siteSetting.findUnique({ where: { key: 'collectingSince' } });
    expect(setting?.value).toBe('2009');
  });

  it('backdates featured records so the recent query returns the intended six', async () => {
    await loadFixture(prisma);

    const recent = await prisma.record.findMany({ orderBy: { addedAt: 'desc' }, take: 6 });

    expect(recent.map((r) => r.title)).toEqual([
      'Mezzanine',
      'Kind of Blue',
      "Sensations' Fix",
      'Vodyanyk',
      'Music for Airports',
      'Moon Safari',
    ]);
  });

  it('is idempotent', async () => {
    await loadFixture(prisma);
    await loadFixture(prisma);

    expect(await prisma.record.count()).toBe(14);
    expect(await prisma.wishlistItem.count()).toBe(6);
  });
});
