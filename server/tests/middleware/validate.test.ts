import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from '../../src/middleware/validate';

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  year: z.number().int(),
  nested: z.object({ deep: z.string() }).optional(),
});

function appWith() {
  const app = express();
  app.use(express.json());
  app.post('/thing', validate(schema), (_req, res) => {
    res.status(201).json(res.locals.body);
  });
  return app;
}

describe('validate', () => {
  it('passes a valid body through on res.locals.body', async () => {
    const response = await request(appWith()).post('/thing').send({ title: 'A', year: 1970 });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ title: 'A', year: 1970 });
  });

  it('returns errors keyed by field so forms can render them inline', async () => {
    const response = await request(appWith()).post('/thing').send({ title: '', year: 'nope' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.fields.title).toBe('Title is required');
    expect(response.body.fields.year).toBeDefined();
  });

  it('flattens a nested path into a dotted key', async () => {
    const response = await request(appWith())
      .post('/thing')
      .send({ title: 'A', year: 1, nested: { deep: 5 } });

    expect(response.status).toBe(400);
    expect(response.body.fields['nested.deep']).toBeDefined();
  });

  it('keeps the first message per field rather than the last', async () => {
    const response = await request(appWith()).post('/thing').send({ title: '', year: 1 });

    expect(response.body.fields.title).toBe('Title is required');
  });

  it('strips unknown keys instead of persisting them', async () => {
    const response = await request(appWith())
      .post('/thing')
      .send({ title: 'A', year: 1970, isAdmin: true });

    expect(response.body).toEqual({ title: 'A', year: 1970 });
    expect(response.body.isAdmin).toBeUndefined();
  });
});
