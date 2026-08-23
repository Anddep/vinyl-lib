import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { loadFixture } from '../fixtures/collection';
import { signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

async function publicOwner() {
  const { agent, user } = await signInAgent();
  await loadFixture(prisma, user.id);
  return { agent, user };
}

describe('GET /api/u/:slug', () => {
  it('returns the profile a collection page needs', async () => {
    const { user } = await publicOwner();

    const response = await request(app).get(`/api/u/${user.slug}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      slug: user.slug,
      displayName: user.displayName,
      avatarUrl: null,
    });
    // Never the email, and never the id: neither is needed to render a page.
    expect(response.body.email).toBeUndefined();
    expect(response.body.id).toBeUndefined();
  });

  it('404s an unknown slug', async () => {
    await request(app).get('/api/u/nobody').expect(404);
  });
});

describe('reading a public collection without a session', () => {
  it('serves records, genres, stats, wishlist, setup and settings', async () => {
    const { user } = await publicOwner();

    const records = await request(app).get(`/api/u/${user.slug}/records`);
    const stats = await request(app).get(`/api/u/${user.slug}/stats`);
    const genres = await request(app).get(`/api/u/${user.slug}/genres`);
    const wishlist = await request(app).get(`/api/u/${user.slug}/wishlist`);
    const setup = await request(app).get(`/api/u/${user.slug}/setup`);
    const settings = await request(app).get(`/api/u/${user.slug}/settings`);

    expect(records.body).toHaveLength(14);
    expect(stats.body.totalRecords).toBe(14);
    expect(genres.body.length).toBeGreaterThan(0);
    expect(wishlist.body).toHaveLength(6);
    expect(setup.body).toHaveLength(5);
    expect(settings.status).toBe(200);
  });

  it('honours sort and limit exactly as the own tree does', async () => {
    const { user } = await publicOwner();

    const response = await request(app).get(`/api/u/${user.slug}/records?sort=addedAt&limit=6`);

    expect(response.body).toHaveLength(6);
    expect(response.body[0].title).toBe('Mezzanine');
    expect(response.body[0].isNew).toBe(true);
  });

  it('serves one owner data and not another', async () => {
    const first = await publicOwner();
    const second = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });
    await second.agent
      .post('/api/records')
      .send({ title: 'Nevermind', artist: 'Nirvana', year: 1991, format: 'LP', genre: 'Grunge' })
      .expect(201);

    expect((await request(app).get(`/api/u/${first.user.slug}/records`)).body).toHaveLength(14);
    expect((await request(app).get(`/api/u/${second.user.slug}/records`)).body).toHaveLength(1);
  });

  it('does not accept a write through the public tree', async () => {
    const { user } = await publicOwner();

    const response = await request(app)
      .post(`/api/u/${user.slug}/records`)
      .send({ title: 'X', artist: 'Y', year: 2000, format: 'LP', genre: 'Jazz' });

    expect(response.status).toBe(404);
  });
});

describe('a private collection', () => {
  it('404s for a stranger, identically to an unknown slug', async () => {
    const { agent, user } = await publicOwner();
    await agent.patch('/api/account').send({ isPublic: false }).expect(200);

    const hidden = await request(app).get(`/api/u/${user.slug}/records`);
    const missing = await request(app).get('/api/u/nobody/records');

    // 404, not 403: a 403 would confirm the slug exists and someone is behind
    // it, which is the one thing "private" is supposed to prevent.
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });

  it('404s for a different signed-in user', async () => {
    const { agent, user } = await publicOwner();
    await agent.patch('/api/account').send({ isPublic: false }).expect(200);
    const other = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });

    await other.agent.get(`/api/u/${user.slug}/records`).expect(404);
  });

  it('still serves the owner their own, so View site works without unhiding', async () => {
    const { agent, user } = await publicOwner();
    await agent.patch('/api/account').send({ isPublic: false }).expect(200);

    const response = await agent.get(`/api/u/${user.slug}/records`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(14);
  });
});

describe('a suspended collection', () => {
  it('404s for everyone, identically to an unknown slug', async () => {
    const { user } = await publicOwner();
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });

    const hidden = await request(app).get(`/api/u/${user.slug}/records`);
    const missing = await request(app).get('/api/u/nobody/records');

    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });
});
