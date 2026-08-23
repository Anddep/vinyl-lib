import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

type Agent = Awaited<ReturnType<typeof signInAgent>>['agent'];

async function twoOwners(): Promise<{ a: Agent; b: Agent }> {
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
  return { a: a.agent, b: b.agent };
}

/**
 * One row per resource: what A creates, and the patch B will attempt.
 *
 * Driven from a table rather than written out three times because the property
 * under test is identical for each, and a resource added later should only have
 * to add a row here to be covered.
 */
const RESOURCES = [
  {
    path: '/api/records',
    create: {
      title: 'Kind of Blue',
      artist: 'Miles Davis',
      year: 1959,
      format: 'LP',
      genre: 'Jazz',
    },
    patch: { title: 'Hijacked' },
    check: async (id: number) => (await prisma.record.findUniqueOrThrow({ where: { id } })).title,
    unchanged: 'Kind of Blue',
  },
  {
    path: '/api/wishlist',
    create: { title: 'Karma', artist: 'Pharoah Sanders' },
    patch: { title: 'Hijacked' },
    check: async (id: number) =>
      (await prisma.wishlistItem.findUniqueOrThrow({ where: { id } })).title,
    unchanged: 'Karma',
  },
  {
    path: '/api/setup',
    create: { icon: 'turntable', label: 'Turntable', value: 'Technics SL-1200 MK2' },
    patch: { label: 'Hijacked' },
    check: async (id: number) =>
      (await prisma.setupItem.findUniqueOrThrow({ where: { id } })).label,
    unchanged: 'Turntable',
  },
] as const;

describe.each(RESOURCES)('$path isolation', ({ path, create, patch, check, unchanged }) => {
  it('does not list another owner rows', async () => {
    const { a, b } = await twoOwners();
    await a.post(path).send(create).expect(201);

    expect((await b.get(path)).body).toHaveLength(0);
  });

  it('404s an update of another owner row and leaves it untouched', async () => {
    const { a, b } = await twoOwners();
    const created = await a.post(path).send(create).expect(201);

    const foreign = await b.patch(`${path}/${created.body.id}`).send(patch);
    const missing = await b.patch(`${path}/999999`).send(patch);

    expect(foreign.status).toBe(404);
    // Same status and same body: a caller must not be able to tell "not yours"
    // from "not there" and enumerate ids that way.
    expect(foreign.body).toEqual(missing.body);
    expect(await check(created.body.id)).toBe(unchanged);
  });

  it('404s a delete of another owner row and leaves it in place', async () => {
    const { a, b } = await twoOwners();
    const created = await a.post(path).send(create).expect(201);

    const foreign = await b.delete(`${path}/${created.body.id}`);
    const missing = await b.delete(`${path}/999999`);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(await check(created.body.id)).toBe(unchanged);
  });

  it('ignores an ownerId in a create body', async () => {
    const { a, b } = await twoOwners();
    const bId = (await b.get('/api/auth/me')).body.user.id;

    await a
      .post(path)
      .send({ ...create, ownerId: bId })
      .expect(201);

    expect((await b.get(path)).body).toHaveLength(0);
    expect((await a.get(path)).body).toHaveLength(1);
  });

  it('ignores an ownerId in an update body', async () => {
    const { a, b } = await twoOwners();
    const bId = (await b.get('/api/auth/me')).body.user.id;
    const created = await a.post(path).send(create).expect(201);

    await a
      .patch(`${path}/${created.body.id}`)
      .send({ ...patch, ownerId: bId })
      .expect(200);

    expect((await b.get(path)).body).toHaveLength(0);
  });
});

describe('reading one record by id', () => {
  it('404s another owner record, indistinguishably from a missing one', async () => {
    const { a, b } = await twoOwners();
    const created = await a
      .post('/api/records')
      .send({
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        year: 1959,
        format: 'LP',
        genre: 'Jazz',
      })
      .expect(201);

    const foreign = await b.get(`/api/records/${created.body.id}`);
    const missing = await b.get('/api/records/999999');

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });
});

describe('settings isolation', () => {
  it('does not overwrite another owner settings', async () => {
    const { a, b } = await twoOwners();

    await a.patch('/api/settings').send({ heroHeadline: 'Mine' }).expect(200);
    await b.patch('/api/settings').send({ heroHeadline: 'Theirs' }).expect(200);

    expect((await a.get('/api/settings')).body.heroHeadline).toBe('Mine');
    expect((await b.get('/api/settings')).body.heroHeadline).toBe('Theirs');
  });

  it('starts empty for a new owner even when another owner has settings', async () => {
    const { a, b } = await twoOwners();
    await a.patch('/api/settings').send({ collectingSince: '2009' }).expect(200);

    expect((await b.get('/api/settings')).body).toEqual({});
  });
});

describe('the whole own tree needs a session', () => {
  it.each([
    '/api/records',
    '/api/genres',
    '/api/stats',
    '/api/wishlist',
    '/api/setup',
    '/api/settings',
  ])('401s GET %s when signed out', async (path) => {
    await request(app).get(path).expect(401);
  });
});
