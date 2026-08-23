import { beforeEach, describe, expect, it } from 'vitest';
import { USER_SLUG_PATTERN, freeUserSlug, isReserved } from '../../src/lib/userSlug';
import { createUser } from '../fixtures/users';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('USER_SLUG_PATTERN', () => {
  it.each(['abc', 'andriy', 'a-b', 'kind-of-blue', 'a'.repeat(32)])('accepts %s', (slug) => {
    expect(USER_SLUG_PATTERN.test(slug)).toBe(true);
  });

  it.each(['ab', 'a'.repeat(33), '-abc', 'abc-', 'Abc', 'a b', 'a_b'])('rejects %s', (slug) => {
    expect(USER_SLUG_PATTERN.test(slug)).toBe(false);
  });
});

describe('isReserved', () => {
  it.each(['admin', 'api', 'auth', 'uploads', 'settings', 'account'])('reserves %s', (slug) => {
    expect(isReserved(slug)).toBe(true);
  });

  it('leaves an ordinary name alone', () => {
    expect(isReserved('andriy')).toBe(false);
  });
});

describe('freeUserSlug', () => {
  it('derives a slug from the display name', async () => {
    expect(await freeUserSlug(prisma, 'Andriy Deputovych')).toBe('andriy-deputovych');
  });

  it('suffixes when the derived slug is taken', async () => {
    await createUser(prisma, { slug: 'andriy' });
    expect(await freeUserSlug(prisma, 'Andriy')).toBe('andriy-2');
  });

  it('suffixes past a reserved word rather than handing it out', async () => {
    expect(await freeUserSlug(prisma, 'Admin')).toBe('admin-2');
  });

  it('pads a name that slugifies too short for the pattern', async () => {
    // slugify('Al') is 'al' — two characters, one below the pattern's minimum.
    expect(USER_SLUG_PATTERN.test(await freeUserSlug(prisma, 'Al'))).toBe(true);
  });

  it('truncates a very long name to the pattern length', async () => {
    const slug = await freeUserSlug(prisma, 'A'.repeat(80));

    expect(slug.length).toBeLessThanOrEqual(32);
    expect(USER_SLUG_PATTERN.test(slug)).toBe(true);
  });
});
