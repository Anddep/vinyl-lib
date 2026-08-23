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

describe.each([
  ['/api/wishlist', 6, 'Fly or Die', 'title'],
  ['/api/setup', 5, 'Turntable', 'label'],
])('GET %s', (path, expectedLength, firstValue, field) => {
  it('returns every item in position order', async () => {
    const response = await agent.get(path);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(expectedLength);
    expect(response.body[0][field]).toBe(firstValue);
  });
});

describe('position ordering', () => {
  it('falls back to id when positions tie', async () => {
    await prisma.wishlistItem.deleteMany({ where: { ownerId: owner.id } });
    await prisma.wishlistItem.createMany({
      data: [
        { title: 'First', artist: 'A', position: 0, ownerId: owner.id },
        { title: 'Second', artist: 'B', position: 0, ownerId: owner.id },
      ],
    });

    const response = await agent.get('/api/wishlist');

    expect(response.body.map((i: { title: string }) => i.title)).toEqual(['First', 'Second']);
  });
});
