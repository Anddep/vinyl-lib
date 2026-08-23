import { createHash, randomBytes } from 'node:crypto';

/**
 * A url-safe random string, used for both the OAuth `state` and the PKCE
 * verifier. base64url rather than hex: same entropy, shorter query string, and
 * nothing that needs escaping in a redirect.
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** The S256 code challenge for a verifier, per RFC 7636. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
