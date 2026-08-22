import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app';

const PASSWORD = 'test-password';

describe('POST /api/auth/login', () => {
  it('sets an httpOnly session cookie on the right password', async () => {
    const response = await request(app).post('/api/auth/login').send({ password: PASSWORD });

    expect(response.status).toBe(204);
    const cookie = String(response.headers['set-cookie'][0]);
    // httpOnly is what stops an injected script reading the session.
    expect(cookie).toMatch(/HttpOnly/i);
    // SameSite=Strict is the CSRF mitigation for this same-origin deployment.
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('401s on the wrong password without revealing why', async () => {
    const response = await request(app).post('/api/auth/login').send({ password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('400s when no password is sent', async () => {
    const response = await request(app).post('/api/auth/login').send({});

    expect(response.status).toBe(400);
  });

  it('400s when password is not a string', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ password: { $ne: null } });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('reports false before login', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.body).toEqual({ authenticated: false });
  });

  it('reports true with a session cookie', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ password: PASSWORD });

    const response = await agent.get('/api/auth/me');

    expect(response.body).toEqual({ authenticated: true });
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ password: PASSWORD });

    await agent.post('/api/auth/logout').expect(204);
    const response = await agent.get('/api/auth/me');

    expect(response.body).toEqual({ authenticated: false });
  });
});
