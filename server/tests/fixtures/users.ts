import type { PrismaClient, User } from '@prisma/client';

let counter = 0;

/**
 * A user with a slug and verified email nobody else in the run will hold.
 *
 * The counter is module-level rather than random: `fileParallelism` is off in
 * vitest.config.mts, so tests within a run are sequential and a counter gives
 * reproducible slugs, which makes a failing assertion readable.
 */
export async function createUser(
  prisma: PrismaClient,
  overrides: Partial<
    Pick<User, 'slug' | 'displayName' | 'email' | 'isPublic' | 'suspendedAt'>
  > = {},
): Promise<User> {
  counter += 1;
  const slug = overrides.slug ?? `user-${counter}`;

  return prisma.user.create({
    data: {
      slug,
      displayName: overrides.displayName ?? `User ${counter}`,
      email: overrides.email === undefined ? `${slug}@example.com` : overrides.email,
      isPublic: overrides.isPublic ?? true,
      suspendedAt: overrides.suspendedAt ?? null,
    },
  });
}
