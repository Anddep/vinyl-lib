import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { signInAgent } from './helpers/auth';
import { resetDb } from './helpers/db';

beforeEach(resetDb);

describe('CORS', () => {
  it('does not hand a wildcard origin to an arbitrary site', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example');

    // The site and its API are same-origin behind both proxies, so no
    // cross-origin caller should ever be granted access.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not answer a cross-origin preflight for a write route', async () => {
    const response = await request(app)
      .options('/api/records')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('security headers', () => {
  it('still sets helmet defaults', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not advertise the framework', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('session cookie', () => {
  it('is Lax rather than Strict, because the OAuth callback is cross-site', async () => {
    const response = await request(app).get('/api/auth/google');
    const cookie = String(response.headers['set-cookie']);

    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });
});

describe('origin check', () => {
  it('rejects a write carrying a foreign Origin', async () => {
    const response = await request(app)
      .post('/api/wishlist')
      .set('Origin', 'https://evil.example')
      .send({ title: 'A', artist: 'B' });

    // 403 before the 401: an attacker should not learn whether the cookie
    // would have been accepted.
    expect(response.status).toBe(403);
  });

  it('allows a write from the app own origin', async () => {
    const { agent } = await signInAgent();

    await agent
      .post('/api/wishlist')
      .set('Origin', 'http://localhost:5173')
      .send({ title: 'A', artist: 'B' })
      .expect(201);
  });

  it('leaves a GET alone whatever its Origin', async () => {
    await request(app).get('/api/health').set('Origin', 'https://evil.example').expect(200);
  });
});
