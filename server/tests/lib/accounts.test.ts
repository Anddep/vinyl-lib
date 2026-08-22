import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSignIn } from '../../src/lib/accounts';
import type { OAuthProfile } from '../../src/lib/oauth/providers';
import { createUser } from '../fixtures/users';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

function profile(overrides: Partial<OAuthProfile> = {}): OAuthProfile {
  return {
    providerUserId: 'sub-1',
    email: 'andriy@example.com',
    emailVerified: true,
    displayName: 'Andriy',
    avatarUrl: null,
    ...overrides,
  };
}

/** The row the migration inserts. resetDb truncates it, so tests re-seed it. */
async function seedBootstrap() {
  return prisma.user.create({
    data: { slug: 'collection', displayName: 'The Collection', bootstrap: true },
  });
}

describe('resolveSignIn', () => {
  it('refuses an unverified email before any lookup', async () => {
    const result = await resolveSignIn('google', profile({ emailVerified: false }), null);

    expect(result).toEqual({ ok: false, reason: 'email_unverified' });
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses a provider that reports no email at all', async () => {
    const result = await resolveSignIn(
      'github',
      profile({ email: null, emailVerified: false }),
      null,
    );

    expect(result).toEqual({ ok: false, reason: 'email_unverified' });
  });

  it('creates an account with a slug derived from the display name', async () => {
    const result = await resolveSignIn('google', profile(), null);

    expect(result.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'andriy@example.com' } });
    expect(user.slug).toBe('andriy');
    expect(user.isPublic).toBe(true);
  });

  it('signs the same identity back in without creating a second account', async () => {
    const first = await resolveSignIn('google', profile(), null);
    const second = await resolveSignIn('google', profile(), null);

    expect(second).toEqual(first);
    expect(await prisma.user.count()).toBe(1);
  });

  it('links a second provider by verified email', async () => {
    const first = await resolveSignIn('google', profile(), null);
    const second = await resolveSignIn(
      'github',
      profile({ providerUserId: 'gh-9', displayName: 'Andriy D' }),
      null,
    );

    expect(second).toEqual(first);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.oAuthIdentity.count()).toBe(2);
  });

  it('compares the email case-insensitively', async () => {
    const first = await resolveSignIn('google', profile(), null);
    const second = await resolveSignIn(
      'github',
      profile({ providerUserId: 'gh-9', email: 'Andriy@Example.COM' }),
      null,
    );

    expect(second).toEqual(first);
  });

  it('keeps different emails as different accounts', async () => {
    await resolveSignIn('google', profile(), null);
    await resolveSignIn(
      'github',
      profile({ providerUserId: 'gh-9', email: 'other@example.com' }),
      null,
    );

    expect(await prisma.user.count()).toBe(2);
  });

  it('bounds a display name', async () => {
    await resolveSignIn('google', profile({ displayName: 'A'.repeat(200) }), null);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'andriy@example.com' } });
    expect(user.displayName.length).toBe(80);
  });

  it('strips formatting characters that would let a name render as something else', async () => {
    // A right-to-left override, which would make the rendered name differ from
    // the stored one. Written as an escape so the source stays readable.
    await resolveSignIn('google', profile({ displayName: 'And\u202Eriy ' }), null);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'andriy@example.com' } });
    expect(user.displayName).toBe('Andriy');
  });

  it('refuses a suspended account', async () => {
    const user = await createUser(prisma, { slug: 'andriy', email: 'andriy@example.com' });
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });

    expect(await resolveSignIn('google', profile(), null)).toEqual({
      ok: false,
      reason: 'suspended',
    });
  });

  it('will not let a suspended account escape by adding a second provider', async () => {
    const user = await createUser(prisma, { slug: 'andriy', email: 'andriy@example.com' });
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });

    const result = await resolveSignIn('github', profile({ providerUserId: 'gh-9' }), null);

    expect(result).toEqual({ ok: false, reason: 'suspended' });
    expect(await prisma.oAuthIdentity.count()).toBe(0);
  });
});

describe('the bootstrap claim', () => {
  it('claims the placeholder rather than creating a second account', async () => {
    const placeholder = await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'andriy@example.com');

    const result = await resolveSignIn('google', profile(), null);

    expect(result).toEqual({ ok: true, userId: placeholder.id });
    expect(await prisma.user.count()).toBe(1);
    const claimed = await prisma.user.findUniqueOrThrow({ where: { id: placeholder.id } });
    expect(claimed.email).toBe('andriy@example.com');
    expect(claimed.displayName).toBe('Andriy');
    // The slug belongs to the owner to change; the claim does not rename them.
    expect(claimed.slug).toBe('collection');
  });

  it('matches the configured address case-insensitively', async () => {
    const placeholder = await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'Andriy@Example.COM');

    expect(await resolveSignIn('google', profile(), null)).toEqual({
      ok: true,
      userId: placeholder.id,
    });
  });

  it('does not fire twice', async () => {
    await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'andriy@example.com');

    await resolveSignIn('google', profile(), null);
    // Someone else, later, with the same variable still configured.
    const second = await resolveSignIn(
      'github',
      profile({ providerUserId: 'gh-9', email: 'someone@example.com', displayName: 'Someone' }),
      null,
    );

    expect(second.ok).toBe(true);
    expect(await prisma.user.count()).toBe(2);
    const placeholder = await prisma.user.findFirstOrThrow({ where: { bootstrap: true } });
    expect(placeholder.email).toBe('andriy@example.com');
  });

  it('leaves the placeholder alone for a non-matching address', async () => {
    await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'andriy@example.com');

    await resolveSignIn('google', profile({ email: 'someone@example.com' }), null);

    const placeholder = await prisma.user.findFirstOrThrow({ where: { bootstrap: true } });
    expect(placeholder.email).toBeNull();
    expect(await prisma.user.count()).toBe(2);
  });

  it('claims nothing when the variable is unset', async () => {
    await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', '');

    await resolveSignIn('google', profile(), null);

    const placeholder = await prisma.user.findFirstOrThrow({ where: { bootstrap: true } });
    expect(placeholder.email).toBeNull();
  });
});

describe('the signup gate', () => {
  it('refuses a new account when closed, but lets an existing one in', async () => {
    vi.stubEnv('SIGNUP_MODE', 'open');
    const first = await resolveSignIn('google', profile(), null);

    vi.stubEnv('SIGNUP_MODE', 'closed');
    expect(await resolveSignIn('google', profile(), null)).toEqual(first);
    expect(
      await resolveSignIn(
        'github',
        profile({ providerUserId: 'gh-9', email: 'new@example.com' }),
        null,
      ),
    ).toEqual({ ok: false, reason: 'signup_closed' });
  });

  it('requires an invite code when in invite mode', async () => {
    vi.stubEnv('SIGNUP_MODE', 'invite');

    expect(await resolveSignIn('google', profile(), null)).toEqual({
      ok: false,
      reason: 'invite_required',
    });
    expect(await prisma.user.count()).toBe(0);
  });

  it('accepts a valid code and marks it redeemed', async () => {
    vi.stubEnv('SIGNUP_MODE', 'invite');
    await prisma.invite.create({ data: { code: 'good-code' } });

    const result = await resolveSignIn('google', profile(), 'good-code');

    expect(result.ok).toBe(true);
    const invite = await prisma.invite.findUniqueOrThrow({ where: { code: 'good-code' } });
    expect(invite.redeemedById).toBe(result.ok ? result.userId : null);
    expect(invite.redeemedAt).not.toBeNull();
  });

  it('gives one indistinguishable answer for unknown, expired and spent codes', async () => {
    vi.stubEnv('SIGNUP_MODE', 'invite');
    const other = await createUser(prisma, { slug: 'other-user' });
    await prisma.invite.create({ data: { code: 'expired', expiresAt: new Date('2020-01-01') } });
    await prisma.invite.create({
      data: { code: 'used', redeemedById: other.id, redeemedAt: new Date() },
    });

    for (const code of ['nonexistent', 'expired', 'used']) {
      expect(await resolveSignIn('google', profile(), code)).toEqual({
        ok: false,
        reason: 'invite_required',
      });
    }
  });

  it('does not consume an invite when the identity already exists', async () => {
    vi.stubEnv('SIGNUP_MODE', 'invite');
    await prisma.invite.create({ data: { code: 'good-code' } });
    await resolveSignIn('google', profile(), 'good-code');

    await prisma.invite.create({ data: { code: 'second-code' } });
    await resolveSignIn('google', profile(), 'second-code');

    const second = await prisma.invite.findUniqueOrThrow({ where: { code: 'second-code' } });
    expect(second.redeemedById).toBeNull();
  });

  it('never gates the bootstrap claim behind an invite', async () => {
    const placeholder = await seedBootstrap();
    vi.stubEnv('SIGNUP_MODE', 'invite');
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'andriy@example.com');

    expect(await resolveSignIn('google', profile(), null)).toEqual({
      ok: true,
      userId: placeholder.id,
    });
  });
});
