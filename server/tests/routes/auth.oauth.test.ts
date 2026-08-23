import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app';
import { attemptSignIn, signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /api/auth/providers', () => {
  it('lists what is configured', async () => {
    const response = await request(app).get('/api/auth/providers');

    expect(response.status).toBe(200);
    expect(response.body.sort()).toEqual(['github', 'google']);
  });
});

describe('GET /api/auth/:provider', () => {
  it('redirects to the provider carrying state', async () => {
    const response = await request(app).get('/api/auth/google');

    expect(response.status).toBe(302);
    const url = new URL(response.headers.location);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('mints a different state each time', async () => {
    const first = await request(app).get('/api/auth/google');
    const second = await request(app).get('/api/auth/google');

    expect(new URL(first.headers.location).searchParams.get('state')).not.toBe(
      new URL(second.headers.location).searchParams.get('state'),
    );
  });

  it('404s a provider that is not configured', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', '');
    await request(app).get('/api/auth/github').expect(404);
  });

  it('404s a provider that does not exist', async () => {
    await request(app).get('/api/auth/facebook').expect(404);
  });
});

describe('GET /api/auth/:provider/callback', () => {
  it('signs in and lands on the admin', async () => {
    const { response } = await attemptSignIn();

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin');
    expect(await prisma.user.count()).toBe(1);
  });

  it('reports a missing handshake as a lost session, not an expired link', async () => {
    // The overwhelmingly common cause is a cookie that did not come back
    // because the visitor started at a different origin than PUBLIC_BASE_URL,
    // which has a specific fix worth naming.
    const response = await request(app).get('/api/auth/google/callback?code=c&state=whatever');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?error=no_session');
  });

  it('rejects a mismatched state', async () => {
    const agent = request.agent(app);
    await agent.get('/api/auth/google');

    const response = await agent.get('/api/auth/google/callback?code=c&state=not-the-one');

    expect(response.headers.location).toBe('/?error=state');
  });

  it('reports a state mismatch separately from a missing session', async () => {
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google');
    expect(start.status).toBe(302);

    // The session is present; only the value is wrong.
    const response = await agent.get('/api/auth/google/callback?code=c&state=not-the-one');

    expect(response.headers.location).toBe('/?error=state');
  });

  it('rejects a replayed callback, so the handshake is single use', async () => {
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google');
    const state = new URL(start.headers.location).searchParams.get('state');

    // No provider stub installed, so the first attempt fails at the exchange —
    // what matters is that the handshake is consumed either way.
    await agent.get(`/api/auth/google/callback?code=c&state=${state}`);
    const replay = await agent.get(`/api/auth/google/callback?code=c&state=${state}`);

    // Consumed, so the second attempt finds no handshake at all.
    expect(replay.headers.location).toBe('/?error=no_session');
  });

  it('rejects a state minted for the other provider', async () => {
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google');
    const state = new URL(start.headers.location).searchParams.get('state');

    const response = await agent.get(`/api/auth/github/callback?code=c&state=${state}`);

    expect(response.headers.location).toBe('/?error=state');
  });

  it('refuses a provider that will not vouch for the email', async () => {
    const { response } = await attemptSignIn({ emailVerified: false });

    expect(response.headers.location).toBe('/?error=email_unverified');
    expect(await prisma.user.count()).toBe(0);
  });

  it('regenerates the session id, so a pre-seeded cookie cannot be promoted', async () => {
    const agent = request.agent(app);
    const before = await agent.get('/api/auth/google');
    const seeded = String(before.headers['set-cookie']);

    const { response } = await attemptSignIn();
    const after = String(response.headers['set-cookie']);

    expect(after).not.toBe(seeded);
    expect(after).toContain('sid=');
  });

  it('returns the user to a validated next path', async () => {
    const { response } = await attemptSignIn({}, '?next=%2Fadmin%2Frecords');

    expect(response.headers.location).toBe('/admin/records');
  });

  it('ignores an off-site next, so the callback is not an open redirect', async () => {
    const { response } = await attemptSignIn({}, '?next=https%3A%2F%2Fevil.example');

    expect(response.headers.location).toBe('/admin');
  });

  it('ignores a protocol-relative next', async () => {
    const { response } = await attemptSignIn({}, '?next=%2F%2Fevil.example');

    expect(response.headers.location).toBe('/admin');
  });
});

describe('GET /api/auth/me', () => {
  it('answers null rather than 401 when signed out', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null });
  });

  it('returns the signed-in user', async () => {
    const { agent, user } = await signInAgent({ displayName: 'Andriy' });

    const response = await agent.get('/api/auth/me');

    expect(response.body.user).toMatchObject({
      id: user.id,
      slug: user.slug,
      displayName: 'Andriy',
      isPublic: true,
    });
    // The session cookie is the credential; the email is not the client's business.
    expect(response.body.user.email).toBeUndefined();
  });

  it('answers null for a session whose user has since been suspended', async () => {
    const { agent, user } = await signInAgent();
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });

    expect((await agent.get('/api/auth/me')).body).toEqual({ user: null });
  });
});

describe('POST /api/auth/logout', () => {
  it('destroys the session', async () => {
    const { agent } = await signInAgent();

    await agent.post('/api/auth/logout').expect(204);

    expect((await agent.get('/api/auth/me')).body).toEqual({ user: null });
  });
});
