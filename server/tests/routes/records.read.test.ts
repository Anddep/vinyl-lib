import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { loadFixture } from '../fixtures/collection';
import { prisma, resetDb } from '../helpers/db';

beforeEach(async () => {
  await resetDb();
  await loadFixture(prisma);
});

describe('GET /api/records', () => {
  it('returns featured records in position order', async () => {
    const response = await request(app).get('/api/records?featured=true&limit=8');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(8);
    expect(response.body[0].title).toBe('Bitches Brew');
    expect(response.body[7].title).toBe('Endtroducing.....');
  });

  it('returns the most recently added first when sorted by addedAt', async () => {
    const response = await request(app).get('/api/records?sort=addedAt&limit=6');

    expect(response.body).toHaveLength(6);
    expect(response.body[0].title).toBe('Mezzanine');
    expect(response.body[5].title).toBe('Moon Safari');
  });

  it('flags only the newest record as new', async () => {
    const response = await request(app).get('/api/records?sort=addedAt&limit=6');

    expect(response.body[0].isNew).toBe(true);
    expect(response.body.slice(1).every((r: { isNew: boolean }) => r.isNew === false)).toBe(true);
  });

  it('clamps limit to 100 so a crafted query cannot dump the table', async () => {
    const response = await request(app).get('/api/records?limit=100000');

    expect(response.status).toBe(200);
    expect(response.body.length).toBeLessThanOrEqual(100);
  });

  it('ignores a non-numeric limit and falls back to the default', async () => {
    const response = await request(app).get('/api/records?limit=abc');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(14);
  });
});
