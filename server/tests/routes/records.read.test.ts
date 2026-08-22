import { beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from '../fixtures/collection';
import { signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

let agent: Awaited<ReturnType<typeof signInAgent>>['agent'];
let owner: Awaited<ReturnType<typeof signInAgent>>['user'];

beforeEach(async () => {
  await resetDb();
  ({ agent, user: owner } = await signInAgent());
  await loadFixture(prisma, owner.id);
});

describe('GET /api/records', () => {
  it('returns every record in position order', async () => {
    const response = await agent.get('/api/records');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(14);
    expect(response.body[0].title).toBe('Bitches Brew');
  });

  it('ignores a featured query rather than filtering on a field that is gone', async () => {
    const response = await agent.get('/api/records?featured=true');

    expect(response.body).toHaveLength(14);
    expect(response.body[0].featured).toBeUndefined();
  });

  it('returns the most recently added first when sorted by addedAt', async () => {
    const response = await agent.get('/api/records?sort=addedAt&limit=6');

    expect(response.body).toHaveLength(6);
    expect(response.body[0].title).toBe('Mezzanine');
    expect(response.body[5].title).toBe('Moon Safari');
  });

  it('flags only the newest record as new', async () => {
    const response = await agent.get('/api/records?sort=addedAt&limit=6');

    expect(response.body[0].isNew).toBe(true);
    expect(response.body.slice(1).every((r: { isNew: boolean }) => r.isNew === false)).toBe(true);
  });

  it('clamps limit to 100 so a crafted query cannot dump the table', async () => {
    const response = await agent.get('/api/records?limit=100000');

    expect(response.status).toBe(200);
    expect(response.body.length).toBeLessThanOrEqual(100);
  });

  it('ignores a non-numeric limit and falls back to the default', async () => {
    const response = await agent.get('/api/records?limit=abc');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(14);
  });
});
