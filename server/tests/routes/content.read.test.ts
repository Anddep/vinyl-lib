import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { loadFixture } from '../fixtures/collection';
import { prisma, resetDb } from '../helpers/db';

beforeEach(async () => {
  await resetDb();
  await loadFixture(prisma);
});

describe.each([
  ['/api/wishlist', 6, 'Fly or Die', 'title'],
  ['/api/setup', 5, 'Turntable', 'label'],
])('GET %s', (path, expectedLength, firstValue, field) => {
  it('returns every item in position order', async () => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(expectedLength);
    expect(response.body[0][field]).toBe(firstValue);
  });
});

describe('position ordering', () => {
  it('falls back to id when positions tie', async () => {
    await prisma.wishlistItem.deleteMany();
    await prisma.wishlistItem.createMany({
      data: [
        { title: 'First', artist: 'A', position: 0 },
        { title: 'Second', artist: 'B', position: 0 },
      ],
    });

    const response = await request(app).get('/api/wishlist');

    expect(response.body.map((i: { title: string }) => i.title)).toEqual(['First', 'Second']);
  });
});
