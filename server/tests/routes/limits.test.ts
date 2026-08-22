import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInAgent } from '../helpers/auth';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const RECORD = {
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  year: 1959,
  format: 'LP',
  genre: 'Jazz',
};

describe('per-account ceilings', () => {
  it('accepts up to the limit and 409s the one after', async () => {
    vi.stubEnv('MAX_WISHLIST_PER_USER', '2');
    const { agent } = await signInAgent();

    await agent.post('/api/wishlist').send({ title: 'A', artist: 'X' }).expect(201);
    await agent.post('/api/wishlist').send({ title: 'B', artist: 'X' }).expect(201);
    const blocked = await agent.post('/api/wishlist').send({ title: 'C', artist: 'X' });

    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/limit/i);
  });

  it('applies to records too', async () => {
    vi.stubEnv('MAX_RECORDS_PER_USER', '1');
    const { agent } = await signInAgent();

    await agent.post('/api/records').send(RECORD).expect(201);
    await agent
      .post('/api/records')
      .send({ ...RECORD, title: 'Blue Train' })
      .expect(409);
  });

  it('applies to setup rows too', async () => {
    vi.stubEnv('MAX_SETUP_PER_USER', '1');
    const { agent } = await signInAgent();

    await agent.post('/api/setup').send({ icon: 'turntable', label: 'A', value: 'B' }).expect(201);
    await agent.post('/api/setup').send({ icon: 'cable', label: 'C', value: 'D' }).expect(409);
  });

  it('counts per owner, not across the table', async () => {
    vi.stubEnv('MAX_WISHLIST_PER_USER', '1');
    const first = await signInAgent();
    const second = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });

    await first.agent.post('/api/wishlist').send({ title: 'A', artist: 'X' }).expect(201);
    await second.agent.post('/api/wishlist').send({ title: 'B', artist: 'X' }).expect(201);
  });

  it('still allows an update once the ceiling is reached', async () => {
    vi.stubEnv('MAX_WISHLIST_PER_USER', '1');
    const { agent } = await signInAgent();
    const created = await agent.post('/api/wishlist').send({ title: 'A', artist: 'X' }).expect(201);

    await agent.patch(`/api/wishlist/${created.body.id}`).send({ title: 'B' }).expect(200);
  });
});

describe('string length caps', () => {
  it.each(['title', 'artist', 'format', 'genre'])(
    'rejects an over-long record %s',
    async (field) => {
      const { agent } = await signInAgent();

      const response = await agent
        .post('/api/records')
        .send({ ...RECORD, [field]: 'x'.repeat(201) });

      expect(response.status).toBe(400);
      expect(response.body.fields[field]).toBeDefined();
    },
  );

  it('rejects an over-long wishlist title', async () => {
    const { agent } = await signInAgent();

    const response = await agent
      .post('/api/wishlist')
      .send({ title: 'x'.repeat(201), artist: 'X' });

    expect(response.status).toBe(400);
    expect(response.body.fields.title).toBeDefined();
  });

  it('allows a setup value longer than a label, because it holds a description', async () => {
    const { agent } = await signInAgent();

    await agent
      .post('/api/setup')
      .send({ icon: 'turntable', label: 'T', value: 'x'.repeat(400) })
      .expect(201);
    const response = await agent
      .post('/api/setup')
      .send({ icon: 'cable', label: 'C', value: 'x'.repeat(501) });

    expect(response.status).toBe(400);
  });
});
