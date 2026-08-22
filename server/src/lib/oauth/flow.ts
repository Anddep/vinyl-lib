import { env } from '../../config/env';
import type { Provider, ProviderId } from './providers';

/** Must match the callback registered at the provider byte-for-byte. */
export function redirectUri(id: ProviderId): string {
  return `${env.PUBLIC_BASE_URL}/api/auth/${id}/callback`;
}

export function authorizeUrl(
  provider: Provider,
  { state, challenge }: { state: string; challenge: string | null },
): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri(provider.id));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);

  if (challenge !== null) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return url.toString();
}

/**
 * Swaps the authorization code for an access token.
 *
 * GitHub answers form-encoded unless asked otherwise, so Accept is explicit.
 * Both providers report a bad code as HTTP 200 with an `error` key rather than
 * a failure status, which is why the token is checked and not the status.
 */
export async function exchangeCode(
  provider: Provider,
  { code, verifier }: { code: string; verifier: string | null },
): Promise<string> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(provider.id),
  });
  if (verifier !== null) {
    body.set('code_verifier', verifier);
  }

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== 'string') {
    throw new Error(`${provider.id} did not return an access token`);
  }
  return payload.access_token;
}
