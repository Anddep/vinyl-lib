import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { signInAgent } from '../helpers/auth';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('PATCH /api/account', () => {
  it('requires a session', async () => {
    await request(app).patch('/api/account').send({ slug: 'andriy' }).expect(401);
  });

  it('changes the slug and the display name', async () => {
    const { agent } = await signInAgent();

    const response = await agent.patch('/api/account').send({
      slug: 'andriy',
      displayName: 'Andriy D',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ slug: 'andriy', displayName: 'Andriy D' });
    expect((await agent.get('/api/auth/me')).body.user.slug).toBe('andriy');
  });

  it('frees the old slug immediately, and the old URL stops resolving', async () => {
    const { agent, user } = await signInAgent();
    await agent.patch('/api/account').send({ slug: 'andriy' }).expect(200);

    await request(app).get(`/api/u/${user.slug}`).expect(404);
    await request(app).get('/api/u/andriy').expect(200);
  });

  it('409s a slug another account already holds', async () => {
    const first = await signInAgent();
    await first.agent.patch('/api/account').send({ slug: 'andriy' }).expect(200);
    const second = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });

    const response = await second.agent.patch('/api/account').send({ slug: 'andriy' });

    expect(response.status).toBe(409);
    expect(response.body.fields.slug).toBeDefined();
  });

  it('accepts the slug it already holds, so saving the form twice is not an error', async () => {
    const { agent } = await signInAgent();
    await agent.patch('/api/account').send({ slug: 'andriy' }).expect(200);

    await agent.patch('/api/account').send({ slug: 'andriy', displayName: 'X' }).expect(200);
  });

  it.each(['ab', 'a'.repeat(33), 'an driy', '-andriy', 'andriy-'])(
    'rejects the malformed slug %s',
    async (slug) => {
      const { agent } = await signInAgent();

      const response = await agent.patch('/api/account').send({ slug });

      expect(response.status).toBe(400);
      expect(response.body.fields.slug).toBeDefined();
    },
  );

  it('lowercases a slug rather than rejecting it, since case is not meaningful in a URL', async () => {
    const { agent } = await signInAgent();

    const response = await agent.patch('/api/account').send({ slug: 'Andriy' });

    expect(response.status).toBe(200);
    expect(response.body.slug).toBe('andriy');
  });

  it.each(['admin', 'api', 'settings'])('rejects the reserved slug %s', async (slug) => {
    const { agent } = await signInAgent();

    const response = await agent.patch('/api/account').send({ slug });

    expect(response.status).toBe(400);
    expect(response.body.fields.slug).toBeDefined();
  });

  it('flips the collection to private and back', async () => {
    const { agent, user } = await signInAgent();

    await agent.patch('/api/account').send({ isPublic: false }).expect(200);
    await request(app).get(`/api/u/${user.slug}`).expect(404);

    await agent.patch('/api/account').send({ isPublic: true }).expect(200);
    await request(app).get(`/api/u/${user.slug}`).expect(200);
  });

  it('rejects an unknown key rather than ignoring it', async () => {
    const { agent } = await signInAgent();

    await agent.patch('/api/account').send({ suspendedAt: null }).expect(400);
  });

  it('rejects an empty display name', async () => {
    const { agent } = await signInAgent();

    const response = await agent.patch('/api/account').send({ displayName: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.fields.displayName).toBeDefined();
  });
});
