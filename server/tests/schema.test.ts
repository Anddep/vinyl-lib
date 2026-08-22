import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb } from './helpers/db';

beforeEach(resetDb);

describe('Record model', () => {
  it('stores the full field set with sensible defaults', async () => {
    const record = await prisma.record.create({
      data: {
        slug: 'bitches-brew',
        title: 'Bitches Brew',
        artist: 'Miles Davis',
        year: 1970,
        format: '2×LP',
        genre: 'Jazz',
        url: 'https://www.discogs.com/release/1481',
        addedAt: new Date('2026-08-18T00:00:00Z'),
      },
    });

    expect(record.position).toBe(0);
    expect(record.coverUrl).toBeNull();
  });

  it('rejects a duplicate slug', async () => {
    const base = {
      title: 'Blue Train',
      artist: 'John Coltrane',
      year: 1958,
      format: 'LP',
      genre: 'Jazz',
    };
    await prisma.record.create({ data: { ...base, slug: 'blue-train' } });

    await expect(prisma.record.create({ data: { ...base, slug: 'blue-train' } })).rejects.toThrow();
  });
});

describe('ordered content models', () => {
  it('defaults position to 0', async () => {
    const wish = await prisma.wishlistItem.create({
      data: { title: 'Karma', artist: 'Pharoah Sanders' },
    });

    expect(wish.position).toBe(0);
  });
});

describe('SiteSetting model', () => {
  it('is keyed by string', async () => {
    await prisma.siteSetting.create({ data: { key: 'collectingSince', value: '2009' } });
    const setting = await prisma.siteSetting.findUnique({ where: { key: 'collectingSince' } });

    expect(setting?.value).toBe('2009');
  });
});
