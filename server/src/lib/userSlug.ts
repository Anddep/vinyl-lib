import type { PrismaClient } from '@prisma/client';
import { slugify, uniqueSlug } from './slug';

/** Both the Prisma client and a transaction client satisfy this. */
type UserReader = Pick<PrismaClient, 'user'>;

/**
 * 3 to 32 characters: lowercase alphanumerics with inner hyphens, and no
 * leading or trailing hyphen. Short enough to type, long enough for a name.
 */
export const USER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/**
 * Names that already collide with a route, or are the obvious next one.
 *
 * Handing out `admin` would not break /admin — the client router matches that
 * first — but /u/admin would read as an official page, which is the
 * impersonation half of the problem rather than the routing half.
 */
export const RESERVED_SLUGS = new Set([
  'about',
  'account',
  'admin',
  'api',
  'assets',
  'auth',
  'favicon',
  'health',
  'index',
  'login',
  'logout',
  'me',
  'new',
  'settings',
  'signin',
  'signout',
  'static',
  'u',
  'uploads',
]);

export function isReserved(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

const MAX_SLUG_LENGTH = 32;

/**
 * The first free slug derived from a display name.
 *
 * `slugify` can return something the pattern rejects — 'al' is too short, an
 * 80-character name too long — so the base is clamped before it is offered. A
 * reserved word counts as taken, which sends it down the same numeric-suffix
 * path as a genuine collision instead of needing a branch of its own.
 */
export async function freeUserSlug(tx: UserReader, displayName: string): Promise<string> {
  let base = slugify(displayName).slice(0, MAX_SLUG_LENGTH);
  while (base.length < 3) {
    base = `${base}-collection`.slice(0, MAX_SLUG_LENGTH);
  }
  base = base.replace(/-+$/, '');

  return uniqueSlug(base, async (candidate) => {
    if (isReserved(candidate)) {
      return true;
    }
    return (await tx.user.count({ where: { slug: candidate } })) > 0;
  });
}
