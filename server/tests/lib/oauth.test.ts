import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeFor, randomToken } from '../../src/lib/oauth/pkce';
import { configuredProviders, getProvider } from '../../src/lib/oauth/providers';
import { authorizeUrl, exchangeCode, redirectUri } from '../../src/lib/oauth/flow';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('pkce', () => {
  it('mints a url-safe token with no padding', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats', () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  it('derives the documented S256 challenge', () => {
    // The worked example from RFC 7636 appendix B.
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('configuredProviders', () => {
  it('lists both when both are configured', () => {
    expect(
      configuredProviders()
        .map((p) => p.id)
        .sort(),
    ).toEqual(['github', 'google']);
  });

  it('omits a provider whose secret is missing, rather than offering a broken button', () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', '');
    expect(configuredProviders().map((p) => p.id)).toEqual(['google']);
    expect(getProvider('github')).toBeNull();
  });

  it('does not resolve an unknown provider name', () => {
    expect(getProvider('facebook')).toBeNull();
  });

  it('uses PKCE for Google and not for GitHub, which does not support it', () => {
    expect(getProvider('google')?.usesPkce).toBe(true);
    expect(getProvider('github')?.usesPkce).toBe(false);
  });
});

describe('redirectUri', () => {
  it('is built from PUBLIC_BASE_URL, because it must match the provider registration exactly', () => {
    expect(redirectUri('google')).toBe('http://localhost:5173/api/auth/google/callback');
  });
});

describe('authorizeUrl', () => {
  it('carries state, the redirect and the challenge for a PKCE provider', () => {
    const url = new URL(authorizeUrl(getProvider('google')!, { state: 'st', challenge: 'ch' }));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri('google'));
  });

  it('omits the challenge entirely for a provider that does not take one', () => {
    const url = new URL(authorizeUrl(getProvider('github')!, { state: 'st', challenge: null }));

    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.has('code_challenge')).toBe(false);
  });
});

describe('exchangeCode', () => {
  it('posts the code and returns the access token', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'tok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchStub);

    const token = await exchangeCode(getProvider('google')!, { code: 'c', verifier: 'v' });

    expect(token).toBe('tok');
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(String(init.body)).toContain('code_verifier=v');
    // Providers differ on the default response format; ask for JSON explicitly.
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
  });

  it('throws when the provider answers 200 without a token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200 }),
      ),
    );

    await expect(
      exchangeCode(getProvider('github')!, { code: 'c', verifier: null }),
    ).rejects.toThrow();
  });
});

describe('fetchProfile', () => {
  it('reads Google userinfo, including the verification flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sub: '42',
              email: 'a@example.com',
              email_verified: true,
              name: 'A',
              picture: 'https://img/a',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    const profile = await getProvider('google')!.fetchProfile('tok');

    expect(profile).toEqual({
      providerUserId: '42',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'A',
      avatarUrl: 'https://img/a',
    });
  });

  it('takes the GitHub address from /user/emails, not from /user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body =
          url === 'https://api.github.com/user'
            ? {
                id: 7,
                login: 'andriy',
                name: 'Andriy',
                avatar_url: 'https://img/g',
                email: 'stale@example.com',
              }
            : [
                { email: 'other@example.com', primary: false, verified: true },
                { email: 'real@example.com', primary: true, verified: true },
              ];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const profile = await getProvider('github')!.fetchProfile('tok');

    expect(profile.providerUserId).toBe('7');
    expect(profile.email).toBe('real@example.com');
    expect(profile.emailVerified).toBe(true);
  });

  it('reports GitHub as unverified when no primary verified address exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body =
          url === 'https://api.github.com/user'
            ? { id: 7, login: 'andriy' }
            : [{ email: 'x@example.com', primary: true, verified: false }];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const profile = await getProvider('github')!.fetchProfile('tok');

    expect(profile.emailVerified).toBe(false);
    expect(profile.email).toBeNull();
  });
});
