import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { loginAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

const valid = {
  title: 'Bitches Brew',
  artist: 'Miles Davis',
  year: 1970,
  format: '2×LP',
  genre: 'Jazz',
};

describe('write access', () => {
  it.each([
    ['post', '/api/records'],
    ['patch', '/api/records/1'],
    ['delete', '/api/records/1'],
  ])('%s %s requires a session', async (method, url) => {
    const agent = request(app) as unknown as Record<string, (u: string) => request.Test>;
    const response = await agent[method](url).send(valid);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Authentication required' });
  });

  it('leaves the table untouched when a write is rejected', async () => {
    await request(app).post('/api/records').send(valid);
    expect(await prisma.record.count()).toBe(0);
  });
});

describe('POST /api/records', () => {
  it('creates a record and derives the slug', async () => {
    const agent = await loginAgent();
    const response = await agent.post('/api/records').send(valid);

    expect(response.status).toBe(201);
    expect(response.body.slug).toBe('bitches-brew');
    expect(response.body.featured).toBe(false);
    expect(response.body.position).toBe(0);
  });

  it('suffixes a colliding slug rather than failing', async () => {
    const agent = await loginAgent();
    await agent.post('/api/records').send(valid).expect(201);

    const response = await agent.post('/api/records').send(valid);

    expect(response.status).toBe(201);
    expect(response.body.slug).toBe('bitches-brew-2');
  });

  it('reports missing fields by name', async () => {
    const agent = await loginAgent();
    const response = await agent.post('/api/records').send({ title: 'Only a title' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(Object.keys(response.body.fields)).toEqual(
      expect.arrayContaining(['artist', 'year', 'format', 'genre']),
    );
  });

  it('rejects a javascript: url', async () => {
    const agent = await loginAgent();
    const response = await agent
      .post('/api/records')
      .send({ ...valid, url: 'javascript:alert(1)' });

    expect(response.status).toBe(400);
    expect(response.body.fields.url).toMatch(/http/i);
  });

  it('accepts an uploaded cover path as well as an external URL', async () => {
    const agent = await loginAgent();

    await agent
      .post('/api/records')
      .send({ ...valid, coverUrl: '/uploads/abc.png' })
      .expect(201);
    await agent
      .post('/api/records')
      .send({ ...valid, title: 'Other', coverUrl: 'https://img.example/a.jpg' })
      .expect(201);
  });

  it('rejects a year outside a plausible range', async () => {
    const agent = await loginAgent();
    const response = await agent.post('/api/records').send({ ...valid, year: 1200 });

    expect(response.status).toBe(400);
    expect(response.body.fields.year).toBeDefined();
  });
});

describe('PATCH /api/records/:id', () => {
  it('applies a partial update without clearing other fields', async () => {
    const agent = await loginAgent();
    const created = await agent.post('/api/records').send(valid);

    const response = await agent
      .patch(`/api/records/${created.body.id}`)
      .send({ genre: 'Fusion', featured: true });

    expect(response.status).toBe(200);
    expect(response.body.genre).toBe('Fusion');
    expect(response.body.featured).toBe(true);
    expect(response.body.title).toBe('Bitches Brew');
    expect(response.body.artist).toBe('Miles Davis');
  });

  it('404s an unknown id', async () => {
    const agent = await loginAgent();
    const response = await agent.patch('/api/records/9999').send({ genre: 'Rock' });

    expect(response.status).toBe(404);
  });

  it('400s a non-numeric id rather than reaching Prisma', async () => {
    const agent = await loginAgent();
    const response = await agent.patch('/api/records/abc').send({ genre: 'Rock' });

    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/records/:id', () => {
  it('removes the record', async () => {
    const agent = await loginAgent();
    const created = await agent.post('/api/records').send(valid);

    await agent.delete(`/api/records/${created.body.id}`).expect(204);

    expect(await prisma.record.count()).toBe(0);
  });

  it('404s an unknown id', async () => {
    const agent = await loginAgent();
    await agent.delete('/api/records/9999').expect(404);
  });
});

describe('GET /api/records/:id', () => {
  it('returns one record for the edit form', async () => {
    const agent = await loginAgent();
    const created = await agent.post('/api/records').send(valid);

    const response = await request(app).get(`/api/records/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Bitches Brew');
  });

  it('404s an unknown id', async () => {
    await request(app).get('/api/records/9999').expect(404);
  });
});
