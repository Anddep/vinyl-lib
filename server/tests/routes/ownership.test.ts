import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

async function twoOwners() {
  const a = await signInAgent({
    providerUserId: 'sub-a',
    email: 'a@example.com',
    displayName: 'A Collector',
  });
  const b = await signInAgent({
    providerUserId: 'sub-b',
    email: 'b@example.com',
    displayName: 'B Collector',
  });
  return { a, b };
}

const RECORD = {
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  year: 1959,
  format: 'LP',
  genre: 'Jazz',
};

describe('creates are stamped with the session owner', () => {
  it('records', async () => {
    const { a } = await twoOwners();

    const created = await a.agent.post('/api/records').send(RECORD).expect(201);

    const row = await prisma.record.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.ownerId).toBe(a.user.id);
  });

  it('ignores an ownerId in the body', async () => {
    const { a, b } = await twoOwners();

    const created = await a.agent
      .post('/api/wishlist')
      .send({ title: 'Karma', artist: 'Pharoah Sanders', ownerId: b.user.id })
      .expect(201);

    const row = await prisma.wishlistItem.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.ownerId).toBe(a.user.id);
  });
});

describe('lists are scoped to the session owner', () => {
  it('shows only your own rows', async () => {
    const { a, b } = await twoOwners();
    await a.agent
      .post('/api/wishlist')
      .send({ title: 'Karma', artist: 'Pharoah Sanders' })
      .expect(201);

    expect((await a.agent.get('/api/wishlist')).body).toHaveLength(1);
    expect((await b.agent.get('/api/wishlist')).body).toHaveLength(0);
  });

  it('401s a signed-out read of the own tree', async () => {
    await request(app).get('/api/wishlist').expect(401);
  });

  it('still 404s an unknown /api path rather than 401ing it', async () => {
    await request(app).get('/api/nonsense').expect(404);
  });
});

describe('two owners can hold the same album slug', () => {
  it('does not suffix across owners', async () => {
    const { a, b } = await twoOwners();

    const first = await a.agent.post('/api/records').send(RECORD).expect(201);
    const second = await b.agent.post('/api/records').send(RECORD).expect(201);

    expect(first.body.slug).toBe('kind-of-blue');
    expect(second.body.slug).toBe('kind-of-blue');
  });

  it('still suffixes within one owner', async () => {
    const { a } = await twoOwners();

    await a.agent.post('/api/records').send(RECORD).expect(201);
    const second = await a.agent.post('/api/records').send(RECORD).expect(201);

    expect(second.body.slug).toBe('kind-of-blue-2');
  });
});

describe('settings are per owner', () => {
  it('does not overwrite another owner value under the same key', async () => {
    const { a, b } = await twoOwners();

    await a.agent.patch('/api/settings').send({ collectingSince: '2009' }).expect(200);
    await b.agent.patch('/api/settings').send({ collectingSince: '2015' }).expect(200);

    expect((await a.agent.get('/api/settings')).body).toEqual({ collectingSince: '2009' });
    expect((await b.agent.get('/api/settings')).body).toEqual({ collectingSince: '2015' });
  });
});
