import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLimiter } from '../../src/lib/limiters';

/** A throwaway app, so the real limits are not consumed by their own test. */
function appWith(limit: number) {
  const app = express();
  app.use(createLimiter({ windowMs: 60_000, limit, force: true }));
  app.get('/x', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('createLimiter', () => {
  it('allows up to the limit and then answers 429', async () => {
    const app = appWith(2);

    await request(app).get('/x').expect(200);
    await request(app).get('/x').expect(200);
    const blocked = await request(app).get('/x');

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });

  it('reports the standard headers rather than the legacy ones', async () => {
    const response = await request(appWith(5)).get('/x');

    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('is effectively open under test unless a limiter asks otherwise', async () => {
    const app = express();
    app.use(createLimiter({ windowMs: 60_000, limit: 1 }));
    app.get('/x', (_req, res) => {
      res.json({ ok: true });
    });

    // Every Supertest request shares one IP, so a real allowance would be spent
    // part-way through the suite and later tests would 429 for reasons that
    // have nothing to do with them.
    await request(app).get('/x').expect(200);
    await request(app).get('/x').expect(200);
    await request(app).get('/x').expect(200);
  });
});
