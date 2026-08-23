import { beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from '../fixtures/collection';
import { signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

let agent: Awaited<ReturnType<typeof signInAgent>>['agent'];
let owner: Awaited<ReturnType<typeof signInAgent>>['user'];

beforeEach(async () => {
  await resetDb();
  ({ agent, user: owner } = await signInAgent());
});

describe('GET /api/stats', () => {
  it('computes counts from the records table', async () => {
    await loadFixture(prisma, owner.id);
    const response = await agent.get('/api/stats');

    expect(response.status).toBe(200);
    expect(response.body.totalRecords).toBe(14);
    // Electronic (5) beats Jazz (4) across the seed. The design mockup shows
    // Jazz, but that reflects a 324-record collection, not these 14 rows.
    expect(response.body.topGenre).toEqual({ name: 'Electronic', count: 5 });
  });

  it('reports the most represented artist', async () => {
    await loadFixture(prisma, owner.id);
    const response = await agent.get('/api/stats');

    // Miles Davis (Bitches Brew, Kind of Blue) and John Coltrane (A Love
    // Supreme, Blue Train) both have two; Coltrane loses the alphabetical tie.
    expect(response.body.topArtist).toEqual({ name: 'John Coltrane', count: 2 });
  });

  it('reads collectingSince from settings rather than deriving it', async () => {
    await loadFixture(prisma, owner.id);
    const response = await agent.get('/api/stats');

    // Every seeded addedAt is 2025 or later, so a derived MIN would never
    // produce 2009 — this is why it is a stored setting.
    expect(response.body.collectingSince).toBe('2009');
  });

  it('breaks an artist tie alphabetically so the card cannot flip', async () => {
    await prisma.record.createMany({
      data: [
        {
          slug: 'z1',
          title: 'Z1',
          artist: 'Zappa',
          year: 1970,
          format: 'LP',
          genre: 'Rock',
          ownerId: owner.id,
        },
        {
          slug: 'z2',
          title: 'Z2',
          artist: 'Zappa',
          year: 1971,
          format: 'LP',
          genre: 'Rock',
          ownerId: owner.id,
        },
        {
          slug: 'a1',
          title: 'A1',
          artist: 'Air',
          year: 1998,
          format: 'LP',
          genre: 'Electronic',
          ownerId: owner.id,
        },
        {
          slug: 'a2',
          title: 'A2',
          artist: 'Air',
          year: 1999,
          format: 'LP',
          genre: 'Electronic',
          ownerId: owner.id,
        },
      ],
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await agent.get('/api/stats');
      expect(response.body.topArtist).toEqual({ name: 'Air', count: 2 });
    }
  });

  it('counts only records added inside the last 30 days', async () => {
    const now = Date.now();
    const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

    await prisma.record.createMany({
      data: [
        {
          slug: 'fresh',
          title: 'Fresh',
          artist: 'X',
          year: 2020,
          format: 'LP',
          genre: 'Rock',
          addedAt: days(2),
          ownerId: owner.id,
        },
        {
          slug: 'edge',
          title: 'Edge',
          artist: 'X',
          year: 2020,
          format: 'LP',
          genre: 'Rock',
          addedAt: days(29),
          ownerId: owner.id,
        },
        {
          slug: 'stale',
          title: 'Stale',
          artist: 'X',
          year: 2020,
          format: 'LP',
          genre: 'Rock',
          addedAt: days(45),
          ownerId: owner.id,
        },
      ],
    });

    const response = await agent.get('/api/stats');

    expect(response.body.addedLast30Days).toBe(2);
    expect(response.body.totalRecords).toBe(3);
  });

  it('returns nulls rather than crashing on an empty collection', async () => {
    const response = await agent.get('/api/stats');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalRecords: 0,
      topGenre: null,
      topArtist: null,
      collectingSince: null,
      addedLast30Days: 0,
    });
  });
});

describe('GET /api/genres', () => {
  it('lists every genre in use, alphabetically, with counts', async () => {
    await loadFixture(prisma, owner.id);
    const response = await agent.get('/api/genres');

    expect(response.status).toBe(200);
    expect(response.body.map((g: { name: string }) => g.name)).toEqual([
      'Electronic',
      'Hip-Hop',
      'Jazz',
      'Rock',
      'Soundtrack',
      'Ukrainian',
    ]);
    expect(response.body.find((g: { name: string }) => g.name === 'Electronic').count).toBe(5);
  });

  it('picks up a genre invented in the admin without a code change', async () => {
    await prisma.record.create({
      data: {
        slug: 'dub',
        title: 'D',
        artist: 'X',
        year: 1977,
        format: 'LP',
        genre: 'Dub',
        ownerId: owner.id,
      },
    });

    const response = await agent.get('/api/genres');

    expect(response.body).toEqual([{ name: 'Dub', count: 1 }]);
  });

  it('returns an empty list rather than failing on an empty collection', async () => {
    const response = await agent.get('/api/genres');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe('with two collections in the database', () => {
  it('counts, tops and windows only the requesting owner rows', async () => {
    await loadFixture(prisma, owner.id);
    const other = await signInAgent({
      providerUserId: 'sub-other',
      email: 'other@example.com',
      displayName: 'Other',
    });
    await other.agent
      .post('/api/records')
      .send({ title: 'Nevermind', artist: 'Nirvana', year: 1991, format: 'LP', genre: 'Grunge' })
      .expect(201);
    await other.agent
      .post('/api/records')
      .send({ title: 'In Utero', artist: 'Nirvana', year: 1993, format: 'LP', genre: 'Grunge' })
      .expect(201);

    const mine = (await agent.get('/api/stats')).body;
    const theirs = (await other.agent.get('/api/stats')).body;

    expect(mine.totalRecords).toBe(14);
    expect(mine.topGenre.name).not.toBe('Grunge');
    expect(theirs.totalRecords).toBe(2);
    expect(theirs.topGenre).toEqual({ name: 'Grunge', count: 2 });
    expect(theirs.topArtist).toEqual({ name: 'Nirvana', count: 2 });
  });

  it('keeps collectingSince per owner', async () => {
    const other = await signInAgent({
      providerUserId: 'sub-other',
      email: 'other@example.com',
    });
    await agent.patch('/api/settings').send({ collectingSince: '2009' }).expect(200);
    await other.agent.patch('/api/settings').send({ collectingSince: '2015' }).expect(200);

    expect((await agent.get('/api/stats')).body.collectingSince).toBe('2009');
    expect((await other.agent.get('/api/stats')).body.collectingSince).toBe('2015');
  });

  it('lists only the requesting owner genres', async () => {
    await loadFixture(prisma, owner.id);
    const other = await signInAgent({
      providerUserId: 'sub-other',
      email: 'other@example.com',
    });
    await other.agent
      .post('/api/records')
      .send({ title: 'Nevermind', artist: 'Nirvana', year: 1991, format: 'LP', genre: 'Grunge' })
      .expect(201);

    const mine = (await agent.get('/api/genres')).body as Array<{ name: string }>;
    const theirs = (await other.agent.get('/api/genres')).body as Array<{ name: string }>;

    expect(mine.map((g) => g.name)).not.toContain('Grunge');
    expect(theirs.map((g) => g.name)).toEqual(['Grunge']);
  });

  it('badges exactly one record per collection, not one per table', async () => {
    await loadFixture(prisma, owner.id);
    const other = await signInAgent({
      providerUserId: 'sub-other',
      email: 'other@example.com',
    });
    // Added after every fixture record, so a table-wide query would badge this
    // one and leave the first collection with none.
    await other.agent
      .post('/api/records')
      .send({ title: 'Nevermind', artist: 'Nirvana', year: 1991, format: 'LP', genre: 'Grunge' })
      .expect(201);

    const mine = (await agent.get('/api/records?sort=addedAt')).body as Array<{ isNew: boolean }>;
    const theirs = (await other.agent.get('/api/records')).body as Array<{ isNew: boolean }>;

    expect(mine.filter((r) => r.isNew)).toHaveLength(1);
    expect(theirs.filter((r) => r.isNew)).toHaveLength(1);
  });
});
