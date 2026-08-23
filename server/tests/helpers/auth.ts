import request from 'supertest';
import { vi } from 'vitest';
import { app } from '../../src/app';
import { prisma } from './db';

export interface StubProfile {
  provider: 'google' | 'github';
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

const DEFAULT: StubProfile = {
  provider: 'google',
  providerUserId: 'sub-1',
  email: 'owner@example.com',
  emailVerified: true,
  displayName: 'Owner',
  avatarUrl: null,
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Answers the token and profile calls the provider modules make.
 *
 * The suite drives the real routes rather than seeding `session.userId`
 * directly: a test-only backdoor would mean the isolation suite never exercises
 * the code that decides who you are, and it would be a production route that
 * must never ship enabled.
 */
function stubProviderFetch(profile: StubProfile): () => void {
  // Captured and put back by hand rather than through vi.unstubAllGlobals():
  // that would drop every global a test had stubbed, not just this fetch, and
  // this helper is called from the middle of other people's tests.
  const original = globalThis.fetch;

  globalThis.fetch = vi.fn(async (url: string) => {
    if (url.includes('/token') || url.includes('/access_token')) {
      return json({ access_token: 'stub-token' });
    }
    if (url.startsWith('https://openidconnect.googleapis.com')) {
      return json({
        sub: profile.providerUserId,
        email: profile.email,
        email_verified: profile.emailVerified,
        name: profile.displayName,
        picture: profile.avatarUrl,
      });
    }
    if (url === 'https://api.github.com/user') {
      return json({
        id: profile.providerUserId,
        login: profile.displayName,
        name: profile.displayName,
        avatar_url: profile.avatarUrl,
      });
    }
    if (url === 'https://api.github.com/user/emails') {
      return json([{ email: profile.email, primary: true, verified: profile.emailVerified }]);
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as unknown as typeof globalThis.fetch;

  return () => {
    globalThis.fetch = original;
  };
}

/**
 * Walks the whole flow and hands back whatever it ended with, so a test can
 * assert on a failed sign-in as easily as a successful one.
 */
export async function attemptSignIn(overrides: Partial<StubProfile> = {}, query = '') {
  const profile = { ...DEFAULT, ...overrides };
  const restore = stubProviderFetch(profile);

  try {
    const agent = request.agent(app);
    const start = await agent.get(`/api/auth/${profile.provider}${query}`);
    const state = new URL(String(start.headers.location)).searchParams.get('state') ?? '';
    const response = await agent.get(
      `/api/auth/${profile.provider}/callback?code=stub-code&state=${encodeURIComponent(state)}`,
    );
    return { agent, start, response };
  } finally {
    restore();
  }
}

/** A signed-in agent and the user row behind it. Throws if sign-in failed. */
export async function signInAgent(overrides: Partial<StubProfile> = {}) {
  const profile = { ...DEFAULT, ...overrides };
  const { agent, response } = await attemptSignIn(overrides);

  const location = String(response.headers.location);
  if (response.status !== 302 || location.startsWith('/?error=')) {
    // Status and body as well as the location: a failure here is either a
    // redirect to an error code or something that did not redirect at all, and
    // the two need very different investigation.
    throw new Error(
      `Sign-in failed: status ${response.status}, location ${location}, body ${JSON.stringify(response.body)}`,
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: profile.email.toLowerCase() },
  });
  return { agent, user };
}
