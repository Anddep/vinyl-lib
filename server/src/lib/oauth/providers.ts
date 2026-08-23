export const PROVIDER_IDS = ['google', 'github'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Everything the account resolver needs, normalised across providers. */
export interface OAuthProfile {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

export interface Provider {
  id: ProviderId;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** GitHub OAuth Apps do not implement PKCE; Google does. */
  usesPkce: boolean;
  clientId: string;
  clientSecret: string;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

type Json = Record<string, unknown>;

/**
 * A bearer GET returning JSON.
 *
 * The User-Agent is not optional politeness: api.github.com rejects a request
 * that arrives without one.
 */
async function getJson(url: string, accessToken: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'vinyl-lib',
    },
  });
  if (!response.ok) {
    throw new Error(`Provider request failed: ${url} answered ${response.status}`);
  }
  return response.json();
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function googleProfile(accessToken: string): Promise<OAuthProfile> {
  const body = (await getJson(
    'https://openidconnect.googleapis.com/v1/userinfo',
    accessToken,
  )) as Json;

  return {
    providerUserId: String(body.sub),
    email: text(body.email),
    // Strictly true, never merely truthy: an absent claim is not a verified one.
    emailVerified: body.email_verified === true,
    displayName: text(body.name) ?? text(body.email) ?? 'Collector',
    avatarUrl: text(body.picture),
  };
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

async function githubProfile(accessToken: string): Promise<OAuthProfile> {
  const user = (await getJson('https://api.github.com/user', accessToken)) as Json;
  // Two calls, because /user.email can be null, can be a no-reply alias, and
  // carries no verification flag. The verified primary address only lives here.
  const emails = (await getJson(
    'https://api.github.com/user/emails',
    accessToken,
  )) as GithubEmail[];
  const primary = Array.isArray(emails)
    ? emails.find((entry) => entry.primary && entry.verified)
    : undefined;

  return {
    providerUserId: String(user.id),
    email: primary?.email ?? null,
    emailVerified: primary !== undefined,
    displayName: text(user.name) ?? text(user.login) ?? 'Collector',
    avatarUrl: text(user.avatar_url),
  };
}

interface Descriptor {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  usesPkce: boolean;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

const DESCRIPTORS: Record<ProviderId, Descriptor> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    usesPkce: true,
    fetchProfile: googleProfile,
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    usesPkce: false,
    fetchProfile: githubProfile,
  },
};

/**
 * Credentials are read at call time rather than at import, so a test can drop a
 * provider with vi.stubEnv and the sign-in screen only ever offers what works.
 */
function credentials(id: ProviderId): { clientId: string; clientSecret: string } | null {
  const prefix = id.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getProvider(id: string): Provider | null {
  if (!PROVIDER_IDS.includes(id as ProviderId)) {
    return null;
  }
  const providerId = id as ProviderId;
  const creds = credentials(providerId);
  return creds ? { id: providerId, ...DESCRIPTORS[providerId], ...creds } : null;
}

export function configuredProviders(): Provider[] {
  return PROVIDER_IDS.map((id) => getProvider(id)).filter(
    (provider): provider is Provider => provider !== null,
  );
}
