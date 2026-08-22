import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LOGIN_MAX_ATTEMPTS, createLoginLimiter } from '../../src/routes/auth';

/** Fresh limiter per app so the counter starts clean. */
function limitedApp(limit: number) {
  const app = express();
  app.post('/try', createLoginLimiter(limit), (_req, res) => res.status(204).end());
  return app;
}

describe('login rate limiter', () => {
  it('allows requests up to the limit, then 429s', async () => {
    const app = limitedApp(3);

    await request(app).post('/try').expect(204);
    await request(app).post('/try').expect(204);
    await request(app).post('/try').expect(204);

    const blocked = await request(app).post('/try');

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many attempts. Try again later.' });
  });

  it('defaults to 10 attempts', () => {
    expect(LOGIN_MAX_ATTEMPTS).toBe(10);
  });
});
