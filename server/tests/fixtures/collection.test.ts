import { beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from './collection';
import { createUser } from './users';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('loadFixture', () => {
  it('loads the sample collection against one owner', async () => {
    const owner = await createUser(prisma, { slug: 'andriy' });

    await loadFixture(prisma, owner.id);

    expect(await prisma.record.count({ where: { ownerId: owner.id } })).toBe(14);
    expect(await prisma.wishlistItem.count({ where: { ownerId: owner.id } })).toBe(6);
    expect(await prisma.setupItem.count({ where: { ownerId: owner.id } })).toBe(5);
  });

  it('loads twice against two owners without a slug collision', async () => {
    const one = await createUser(prisma, { slug: 'one-user' });
    const two = await createUser(prisma, { slug: 'two-user' });

    await loadFixture(prisma, one.id);
    await loadFixture(prisma, two.id);

    expect(await prisma.record.count()).toBe(28);
  });
});

describe('createUser', () => {
  it('generates a distinct slug and email each call', async () => {
    const one = await createUser(prisma);
    const two = await createUser(prisma);

    expect(one.slug).not.toBe(two.slug);
    expect(one.email).not.toBe(two.email);
  });
});
