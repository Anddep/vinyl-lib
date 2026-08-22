import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb } from './helpers/db';

beforeEach(resetDb);

async function makeUser(slug: string) {
  return prisma.user.create({ data: { slug, displayName: slug, email: `${slug}@example.com` } });
}

describe('User model', () => {
  it('defaults to public, unsuspended and non-bootstrap', async () => {
    const user = await makeUser('andriy');

    expect(user.isPublic).toBe(true);
    expect(user.suspendedAt).toBeNull();
    expect(user.bootstrap).toBe(false);
  });

  it('rejects a duplicate slug', async () => {
    await makeUser('andriy');
    await expect(
      prisma.user.create({ data: { slug: 'andriy', displayName: 'Someone else' } }),
    ).rejects.toThrow();
  });

  it('allows many users with no email, so the bootstrap row is not special-cased', async () => {
    await prisma.user.create({ data: { slug: 'a-user', displayName: 'A' } });
    await prisma.user.create({ data: { slug: 'b-user', displayName: 'B' } });

    expect(await prisma.user.count()).toBe(2);
  });
});

describe('OAuthIdentity model', () => {
  it('rejects the same provider account attaching twice', async () => {
    const user = await makeUser('andriy');
    const other = await makeUser('someone');
    await prisma.oAuthIdentity.create({
      data: { provider: 'google', providerUserId: '1', userId: user.id },
    });

    await expect(
      prisma.oAuthIdentity.create({
        data: { provider: 'google', providerUserId: '1', userId: other.id },
      }),
    ).rejects.toThrow();
  });

  it('cascades when its user is deleted', async () => {
    const user = await makeUser('andriy');
    await prisma.oAuthIdentity.create({
      data: { provider: 'github', providerUserId: '9', userId: user.id },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.oAuthIdentity.count()).toBe(0);
  });
});

describe('Invite model', () => {
  it('lets one invite be redeemed by exactly one user', async () => {
    const first = await makeUser('first');
    const second = await makeUser('second');
    await prisma.invite.create({ data: { code: 'abc', redeemedById: first.id } });

    await expect(
      prisma.invite.create({ data: { code: 'def', redeemedById: second.id } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.invite.create({ data: { code: 'ghi', redeemedById: first.id } }),
    ).rejects.toThrow();
  });
});

describe('Record ownership', () => {
  const base = {
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    year: 1959,
    format: 'LP',
    genre: 'Jazz',
  };

  it('lets two owners hold the same slug', async () => {
    const one = await makeUser('one-user');
    const two = await makeUser('two-user');

    await prisma.record.create({ data: { ...base, slug: 'kind-of-blue', ownerId: one.id } });
    await prisma.record.create({ data: { ...base, slug: 'kind-of-blue', ownerId: two.id } });

    expect(await prisma.record.count()).toBe(2);
  });

  it('still rejects a duplicate slug within one owner', async () => {
    const one = await makeUser('one-user');
    await prisma.record.create({ data: { ...base, slug: 'kind-of-blue', ownerId: one.id } });

    await expect(
      prisma.record.create({ data: { ...base, slug: 'kind-of-blue', ownerId: one.id } }),
    ).rejects.toThrow();
  });

  it('cascades records, wishlist, setup and settings when the owner goes', async () => {
    const one = await makeUser('one-user');
    await prisma.record.create({ data: { ...base, slug: 'kob', ownerId: one.id } });
    await prisma.wishlistItem.create({
      data: { title: 'Karma', artist: 'Pharoah Sanders', ownerId: one.id },
    });
    await prisma.setupItem.create({
      data: { icon: 'turntable', label: 'T', value: 'V', ownerId: one.id },
    });
    await prisma.siteSetting.create({
      data: { key: 'collectingSince', value: '2009', ownerId: one.id },
    });

    await prisma.user.delete({ where: { id: one.id } });

    expect(await prisma.record.count()).toBe(0);
    expect(await prisma.wishlistItem.count()).toBe(0);
    expect(await prisma.setupItem.count()).toBe(0);
    expect(await prisma.siteSetting.count()).toBe(0);
  });
});

describe('SiteSetting model', () => {
  it('is keyed by owner and key together', async () => {
    const one = await makeUser('one-user');
    const two = await makeUser('two-user');

    await prisma.siteSetting.create({
      data: { ownerId: one.id, key: 'collectingSince', value: '2009' },
    });
    await prisma.siteSetting.create({
      data: { ownerId: two.id, key: 'collectingSince', value: '2015' },
    });

    const stored = await prisma.siteSetting.findUnique({
      where: { ownerId_key: { ownerId: two.id, key: 'collectingSince' } },
    });

    expect(stored?.value).toBe('2015');
  });
});

describe('Upload model', () => {
  it('records bytes against an owner', async () => {
    const one = await makeUser('one-user');
    await prisma.upload.create({
      data: { ownerId: one.id, path: `${one.id}/a.webp`, bytes: 1234 },
    });

    const used = await prisma.upload.aggregate({
      where: { ownerId: one.id },
      _sum: { bytes: true },
    });

    expect(used._sum.bytes).toBe(1234);
  });
});
